"""Host-side daemon: FastAPI app factory and uvicorn entry point."""

import contextlib
import os
from collections.abc import AsyncGenerator, Callable

from fastapi import FastAPI, Request

from claudebox import (
    JSONResponse,
    configure_logging,
    is_dev_mode,
    serialization,
    set_dev_mode,
    use_rotating_log_file,
)
from claudebox.constants import daemon_log_dir
from claudebox.extensions.tickets import TicketError
from . import domain, handlers, serving


def run_daemon(*args, **cli_args) -> None:
    """Start the daemon server with uvicorn."""

    dev_mode = cli_args["dev"]
    port = cli_args["port"]

    set_dev_mode(dev_mode)
    configure_logging(console=True, debug=dev_mode)

    if not dev_mode:
        use_rotating_log_file(daemon_log_dir() / f"daemon-{port}.log")

    os.environ["CLAUDEBOX_DAEMON_ARGS"] = serialization.dumps(cli_args)
    serving.backend_server(daemon_factory, port=port)


def daemon_factory() -> FastAPI:
    """Create and configure the FastAPI application instance for uvicorn reload mode."""

    dev_mode = is_dev_mode()
    configure_logging(console=True, debug=dev_mode)

    cli_args = serialization.loads(os.environ["CLAUDEBOX_DAEMON_ARGS"])

    app = FastAPI(
        lifespan=daemon_lifespan(**cli_args),
        default_response_class=JSONResponse,
    )
    app.add_exception_handler(domain.DaemonError, handle_daemon_error)  # ty: ignore[invalid-argument-type]
    app.add_exception_handler(TicketError, handle_ticket_error)  # ty: ignore[invalid-argument-type]
    app.include_router(handlers.api_router)
    serving.frontend_server(app)

    return app


async def handle_daemon_error(_request: Request, exc: domain.DaemonError) -> JSONResponse:
    """Return structured JSON for domain errors."""

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error_key, **exc.context},
    )


async def handle_ticket_error(_request: Request, exc: TicketError) -> JSONResponse:
    """Return structured JSON for ticket domain errors."""

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error_key, **exc.context},
    )


def daemon_lifespan(**_cli_args) -> Callable:
    """Build a FastAPI lifespan that manages domain state."""

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs) -> AsyncGenerator[None]:
        async with domain.managed():
            yield

    return handler
