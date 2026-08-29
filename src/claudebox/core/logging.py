"""Structured logging configuration using structlog."""

import logging
import logging.handlers
import sys
import threading
from pathlib import Path

import structlog

from . import serialization
from .log_rendering import format_timestamp_iso
from ..core.fs import touch_dir


# Module state
_lock = threading.Lock()
_root: logging.Logger | None = None
_configured = False
_handlers: dict[str, logging.Handler] = {}


# Shared processors for both structlog and stdlib
_shared_processors = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.stdlib.PositionalArgumentsFormatter(),
    structlog.processors.TimeStamper(),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
    lambda _logger, _name, event: serialization.serialize(event),
    structlog.processors.UnicodeDecoder(),
]

structlog.configure(
    processors=_shared_processors + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)


def configure_logging(console: bool = False, debug: bool = False) -> None:
    """Configure structlog with optional console output."""

    global _configured

    with _lock:
        if _configured:
            return

        _configure_logging(console, debug)
        _configured = True


def _configure_logging(console: bool, debug: bool) -> None:
    """Set up root logger and optional console handler."""

    global _root

    level = logging.DEBUG if debug else logging.INFO

    # Configure root logger
    _root = logging.getLogger()
    _root.handlers.clear()
    _root.setLevel(level)

    # Console handler
    if console:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            structlog.stdlib.ProcessorFormatter(
                foreign_pre_chain=_shared_processors,
                processors=[
                    structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                    format_timestamp_iso,
                    structlog.dev.ConsoleRenderer(
                        exception_formatter=structlog.dev.RichTracebackFormatter(
                            show_locals=False,
                        ),
                    ),
                ],
            ),
        )
        _root.addHandler(handler)

    # Quiet noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("filelock").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sse_starlette").setLevel(logging.WARNING)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structlog logger, auto-configuring on first call if needed."""

    if not _configured:
        configure_logging()

    return structlog.get_logger(name)


def use_log_file(path: str | Path) -> None:
    """Attach file handler and flush buffered logs.

    Creates parent dirs, replacing any existing file handler.
    """

    if not _configured:
        configure_logging()

    if handler := _handlers.pop("file", None):
        handler.close()
        _root.removeHandler(handler)  # ty: ignore[unresolved-attribute]

    path = Path(path)
    touch_dir(path.parent)

    _handlers["file"] = handler = logging.FileHandler(
        path,
        mode="a",
        encoding="utf-8",
    )

    _use_log_file(handler)


def use_rotating_log_file(
    path: str | Path,
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 5,
) -> None:
    """Attach a rotating file handler for persistent daemon-level logging.

    Kept separate from use_log_file() (per-session) so a daemon-level rotating log and a
    per-session append-only log can coexist.
    """

    if not _configured:
        configure_logging()

    if handler := _handlers.pop("rotating_file", None):
        handler.close()
        _root.removeHandler(handler)  # ty: ignore[unresolved-attribute]

    path = Path(path)
    touch_dir(path.parent)

    _handlers["rotating_file"] = handler = logging.handlers.RotatingFileHandler(
        path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )

    _use_log_file(handler)


def _use_log_file(handler: logging.FileHandler) -> None:
    """Configure formatter and attach handler to root."""

    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=_shared_processors,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.JSONRenderer(serializer=serialization.dumps),
            ],
        ),
    )
    _root.addHandler(handler)  # ty: ignore[unresolved-attribute]
