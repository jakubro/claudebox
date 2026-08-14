"""Event-loop lag detection, exposed via /api/daemon/health for host-side supervision."""

import time

from claudebox import AsyncPoller
from ..constants import WATCHDOG_HEARTBEAT_INTERVAL, WATCHDOG_LAG_THRESHOLD


class DaemonWatchdog(AsyncPoller):
    """Detect event-loop lag; `.healthy` backs /api/daemon/health for a host-side poller.

    Comparing intended wake-up against actual catches a blocked loop a plain heartbeat timer would call healthy.
    A host-side timer restarts the unit when health reports unhealthy or stops answering (see ARCHITECTURE.md).

    Catches a stalled loop only, not one parked on an await that never returns (see ARCHITECTURE.md).
    """

    def __init__(self) -> None:
        super().__init__(
            interval=WATCHDOG_HEARTBEAT_INTERVAL.total_seconds(),
            name="Daemon watchdog",
        )

        self._next_wake = 0.0
        self.healthy = True

    async def start(self) -> None:
        """Anchor the lag baseline to actual start time, not construction time, then poll."""

        self._next_wake = time.monotonic() + self._interval

        await super().start()

    async def _poll(self) -> None:
        """Compare actual wake-up against intended, updating `healthy`."""

        now = time.monotonic()
        lag = now - self._next_wake
        self._next_wake = now + self._interval

        self.healthy = lag <= WATCHDOG_LAG_THRESHOLD.total_seconds()

        if not self.healthy:
            self._logger.warning("Event loop lag %.2fs exceeds watchdog threshold", lag)
