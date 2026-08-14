"""Blocking-work pools, split by concern so one saturated class cannot starve the others."""

import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import TypeVar

from claudebox import get_logger


T = TypeVar("T")


# Sized per concern and shared across workspaces; podman stays small since it serialises on its own store lock.
LISTING_WORKERS = 8
PODMAN_WORKERS = 4
STATE_WORKERS = 4

# Reported once the job finishes - a job still queued has nothing to report from; live depth comes from stats().
QUEUE_WARN_SECONDS = 2.0


# eq=False keeps identity hashing, so same-microsecond jobs stay distinct entries.
@dataclass(eq=False)
class Admission:
    """When a job was handed to a pool, when a worker picked it up, and when it finished."""

    submitted_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    finished_at: float | None = None

    @property
    def started(self) -> bool:
        """Whether a worker ever picked the job up."""

        return self.started_at is not None

    @property
    def queued_seconds(self) -> float:
        """Seconds spent waiting for a worker - so far, if one never arrived."""

        return (self.started_at or time.monotonic()) - self.submitted_at

    @property
    def running_seconds(self) -> float:
        """Seconds spent executing - so far, if still running. Zero before it starts."""

        if self.started_at is None:
            return 0.0

        return (self.finished_at or time.monotonic()) - self.started_at


@dataclass(frozen=True)
class PoolStats:
    """What a pool is doing right now, in the terms an outage gets diagnosed in."""

    name: str
    workers: int
    queued: int
    running: int
    oldest_queued_seconds: float

    def asdict(self) -> dict:
        """Flat mapping for structured logs and the health payload."""

        return {
            "workers": self.workers,
            "queued": self.queued,
            "running": self.running,
            "oldest_queued_seconds": round(self.oldest_queued_seconds, 3),
        }


class ObservedPool(ThreadPoolExecutor):
    """A pool that can say how deep its backlog is and how long the front of it has waited."""

    def __init__(self, max_workers: int, *, name: str) -> None:
        super().__init__(max_workers=max_workers, thread_name_prefix=f"daemon-{name}")

        self.name = name
        self._logger = get_logger(__name__)
        self._pending: set[Admission] = set()
        self._pending_lock = threading.Lock()

    def submit(self, fn, /, *args, **kwargs) -> Future:
        """Submit `fn`, recording how long it waits for a worker and how long it then runs."""

        admission = Admission()

        with self._pending_lock:
            self._pending.add(admission)

        def _observed(*call_args, **call_kwargs):
            admission.started_at = time.monotonic()

            try:
                return fn(*call_args, **call_kwargs)
            finally:
                admission.finished_at = time.monotonic()
                self._warn_if_queued_long(admission)

        try:
            future = super().submit(_observed, *args, **kwargs)
        except BaseException:
            self._discard(admission)

            raise

        # Off the future, not the wrapper: a job cancelled while queued never runs the wrapper.
        future.add_done_callback(lambda _: self._discard(admission))

        return future

    def stats(self) -> PoolStats:
        """Snapshot the backlog. Cheap enough to call from a health check."""

        with self._pending_lock:
            admissions = list(self._pending)

        waiting = [a for a in admissions if not a.started]

        return PoolStats(
            name=self.name,
            workers=self._max_workers,
            queued=len(waiting),
            running=len(admissions) - len(waiting),
            oldest_queued_seconds=max((a.queued_seconds for a in waiting), default=0.0),
        )

    def _discard(self, admission: Admission) -> None:
        """Stop counting a job, however it left the queue."""

        with self._pending_lock:
            self._pending.discard(admission)

    def _warn_if_queued_long(self, admission: Admission) -> None:
        """Report a job that waited longer for a worker than a healthy pool ever should."""

        if admission.queued_seconds < QUEUE_WARN_SECONDS:
            return

        self._logger.warning(
            "pool_queue_backlog",
            pool=self.name,
            queued_seconds=round(admission.queued_seconds, 3),
            running_seconds=round(admission.running_seconds, 3),
            **self.stats().asdict(),
        )


@dataclass(frozen=True)
class DaemonExecutors:
    """The daemon's blocking pools, one per class of work."""

    listing: ObservedPool
    podman: ObservedPool
    state: ObservedPool

    @classmethod
    def create(cls) -> "DaemonExecutors":
        """Build the pools with their thread-name prefixes, so a stack dump names the concern."""

        return cls(
            listing=ObservedPool(LISTING_WORKERS, name="listing"),
            podman=ObservedPool(PODMAN_WORKERS, name="podman"),
            state=ObservedPool(STATE_WORKERS, name="state"),
        )

    def stats(self) -> dict[str, dict]:
        """Every pool's backlog, keyed by concern - the body of a saturation report."""

        return {pool.name: pool.stats().asdict() for pool in self._pools}

    def saturated(self) -> list[str]:
        """Pools with work queued behind busy workers, longest wait first."""

        snapshots = [pool.stats() for pool in self._pools]
        backed_up = [s for s in snapshots if s.queued]

        return [s.name for s in sorted(backed_up, key=lambda s: -s.oldest_queued_seconds)]

    def shutdown(self) -> None:
        """Release every pool without waiting on in-flight work."""

        for pool in self._pools:
            pool.shutdown(wait=False)

    @property
    def _pools(self) -> tuple[ObservedPool, ...]:
        return (self.listing, self.podman, self.state)


def tracked(fn: Callable[[], T]) -> tuple[Callable[[], T], Admission]:
    """Wrap a pool-bound callable so a fired timeout can say whether the work ever ran."""

    admission = Admission()

    def _run() -> T:
        admission.started_at = time.monotonic()

        return fn()

    return _run, admission
