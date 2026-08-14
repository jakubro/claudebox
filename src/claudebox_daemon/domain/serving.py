"""Serving-capacity probe - can the daemon still get work done, not just schedule callbacks."""

import asyncio
import time

from claudebox import AsyncPoller
from .executors import DaemonExecutors
from ..constants import (
    SERVING_PROBE_INTERVAL,
    SERVING_PROBE_MAX_FAILURES,
    SERVING_PROBE_TIMEOUT,
)


# podman is excluded: a 60s spawn is legitimate, so gating a restart on it would restart a working daemon.
PROBED_POOLS = ("listing", "state")


class ServingProbe(AsyncPoller):
    """Submit a trivial job to each serving pool and require it to come back."""

    def __init__(self, executors: DaemonExecutors) -> None:
        super().__init__(
            interval=SERVING_PROBE_INTERVAL.total_seconds(),
            name="Serving probe",
        )

        self._executors = executors
        self.healthy = True
        self.failing: list[str] = []
        self.consecutive_failures = 0
        self.last_latency_seconds: dict[str, float] = {}

    async def _poll(self) -> None:
        """Probe every serving pool once, updating `healthy` and `failing`."""

        failing = []

        for name in PROBED_POOLS:
            if not await self._pool_answers(name):
                failing.append(name)

        self.failing = failing
        self.consecutive_failures = self.consecutive_failures + 1 if failing else 0
        self.healthy = self.consecutive_failures < SERVING_PROBE_MAX_FAILURES

        if failing:
            self._logger.warning(
                "serving_probe_unanswered",
                pools=failing,
                consecutive_failures=self.consecutive_failures,
                timeout=SERVING_PROBE_TIMEOUT.total_seconds(),
                stats=self._executors.stats(),
            )

    async def _pool_answers(self, name: str) -> bool:
        """Whether `name` ran a trivial job within the bound."""

        pool = getattr(self._executors, name)
        loop = asyncio.get_running_loop()
        started = time.monotonic()

        try:
            await asyncio.wait_for(
                loop.run_in_executor(pool, lambda: None),
                timeout=SERVING_PROBE_TIMEOUT.total_seconds(),
            )
        except TimeoutError:
            self.last_latency_seconds[name] = SERVING_PROBE_TIMEOUT.total_seconds()

            return False

        self.last_latency_seconds[name] = round(time.monotonic() - started, 4)

        return True
