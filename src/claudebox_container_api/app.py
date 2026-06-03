"""FastAPI app factory — container API entry point."""

import contextlib
import os
from collections.abc import Callable

from fastapi import FastAPI, Request

from claudebox import (
    ApiError,
    JSONResponse,
    configure_logging,
    http_serve,
    is_dev_mode,
    serialization,
)
from claudebox.constants import CONTAINER_API_DIR, CORE_DIR
from . import files, handlers, session


def run_container_api(*args, **cli_args) -> None:
    """Start the container API server with uvicorn."""

    dev_mode = is_dev_mode()
    configure_logging()

    workspace = os.environ.get("CLAUDEBOX_PWD", os.getcwd())
    os.chdir(workspace)

    os.environ["CLAUDEBOX_PWD"] = workspace
    os.environ["CLAUDEBOX_CONTAINER_API_ARGS"] = serialization.dumps(cli_args)

    http_serve(
        api_factory,
        port=cli_args["port"],
        dev=dev_mode,
        reload_dirs=[CORE_DIR, CONTAINER_API_DIR],
    )


def api_factory() -> FastAPI:
    """Create and configure the FastAPI application instance for uvicorn reload mode."""

    configure_logging()

    workspace = os.environ["CLAUDEBOX_PWD"]
    cli_args = serialization.loads(os.environ["CLAUDEBOX_CONTAINER_API_ARGS"])

    app = FastAPI(
        lifespan=api_lifespan(workspace, **cli_args),
        default_response_class=JSONResponse,
    )
    app.add_exception_handler(ApiError, handle_api_error)  # ty: ignore[invalid-argument-type]
    app.include_router(handlers.api_router)

    return app


async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
    """Return structured JSON for domain errors."""

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error_key, **exc.context},
    )


def api_lifespan(workspace: str, **cli_args) -> Callable:
    """Build a FastAPI lifespan that manages domain state and services."""

    @contextlib.asynccontextmanager
    async def handler(app):
        # noinspection PyAbstractClass
        async with contextlib.AsyncExitStack() as stack:
            await stack.enter_async_context(session.managed(workspace=workspace, **cli_args)(app))
            assert session.current is not None
            await stack.enter_async_context(files.managed(session.current.workspace)(app))
            yield

    return handler
