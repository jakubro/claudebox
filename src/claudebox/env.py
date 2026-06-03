"""Environment utilities for checking runtime configuration."""

import os


def is_dev_mode() -> bool:
    """Check if CLAUDEBOX_DEV=1, enabling DEBUG logging and dev behaviors."""

    return os.environ.get("CLAUDEBOX_DEV") == "1"


def set_dev_mode(enabled: bool) -> None:
    """Set CLAUDEBOX_DEV environment variable."""

    os.environ["CLAUDEBOX_DEV"] = str(int(enabled))
