"""Server wiring - Caddy reverse proxy for H2/TLS in production, uvicorn in dev."""

import atexit
import logging
import os
import subprocess
import textwrap
import threading

from fastapi import FastAPI
from starlette.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

from claudebox import (
    format_install_info,
    get_install_info,
    get_logger,
    http_serve,
    is_dev_mode,
    make_timestamped_dir_prefix,
    serialization,
    wrap_box,
)
from claudebox.constants import (
    CORE_DIR,
    DAEMON_DEV_PORT,
    DAEMON_DIR,
    DAEMON_PORT,
    FRONTEND_DIR,
    FRONTEND_DIST_DIR,
    HOST_TEMP_RUN_DIR,
    LICENSE,
    caddy_binary_path,
)
from .constants import SERVER_PROCESS_TERMINATION_TIMEOUT


def backend_server(factory, *, port: int) -> None:
    """Run the daemon server - Caddy H2/TLS proxy in production, uvicorn with reload in dev."""

    logger = get_logger(__name__)
    dev_mode = is_dev_mode()

    if dev_mode:
        frontend_dev_server(port)
    else:
        https_proxy(port)

    logger.info(_startup_banner(port))
    http_serve(
        factory,
        port=_backend_port(port),
        dev=dev_mode,
        reload_dirs=[CORE_DIR, DAEMON_DIR] if dev_mode else None,
    )


def https_proxy(port: int) -> None:
    """Launch Caddy as a reverse proxy for H2/TLS, with atexit cleanup."""

    if is_dev_mode():
        return

    caddy = caddy_binary_path()

    if not caddy.exists():
        raise FileNotFoundError(
            f"Caddy binary not found at {caddy}. Run ~/.claudebox/lib/bin/install.sh to install it."
        )

    caddy_dir = HOST_TEMP_RUN_DIR / make_timestamped_dir_prefix()
    caddy_dir.mkdir(parents=True, exist_ok=True)
    caddyfile = caddy_dir / "Caddyfile"

    caddyfile.write_text(
        textwrap.dedent(
            f"""
                {{
                    admin off
                    skip_install_trust
                    auto_https disable_redirects
                    renew_interval 2m
                    log default {{
                        output stdout
                        level error
                        format json
                    }}
                }}

                :{port} {{
                    tls {{
                        on_demand
                        issuer internal {{
                            lifetime 12h
                        }}
                    }}
                    reverse_proxy localhost:{_backend_port(port)}
                }}
            """
        )
    )

    proc = subprocess.Popen(
        [caddy, "run", "--config", caddyfile],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    _drain_subprocess_output(proc, "caddy")
    atexit.register(_stop_subprocess, proc)


def frontend_server(app: FastAPI) -> None:
    """Mount built frontend assets and SPA fallback; no-op in dev mode."""

    if is_dev_mode():
        return

    assets_dir = FRONTEND_DIST_DIR / "assets"
    index_html = (FRONTEND_DIST_DIR / "index.html").read_text()

    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def index():
        """Serve the SPA entry point."""

        return HTMLResponse(content=index_html)

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        """Return SPA shell for unmatched paths (client-side routing)."""

        return HTMLResponse(content=index_html)


def frontend_dev_server(port: int) -> None:
    """Launch Vite as a sibling process to uvicorn, with atexit cleanup."""

    if not is_dev_mode():
        return

    proc = _start_frontend_dev_server(port)
    atexit.register(_stop_subprocess, proc)


def _start_frontend_dev_server(port: int) -> subprocess.Popen:
    """Launch the Vite dev server as a standalone subprocess."""

    return subprocess.Popen(
        ["npm", "run", "dev", "--", "--host", "--port", str(_frontend_port(port))],
        cwd=FRONTEND_DIR,
        env={
            **os.environ,
            "VITE_API_URL": f"http://localhost:{_backend_port(port)}",
        },
    )


def _drain_subprocess_output(proc: subprocess.Popen, name: str) -> None:
    """Read subprocess stdout in a daemon thread and log each line."""

    logger = get_logger(name)
    log_levels = logging.getLevelNamesMapping()

    def drain() -> None:
        if proc.stdout is None:
            return

        for line in proc.stdout:
            try:
                line = line.decode("utf-8", errors="replace").rstrip()
                obj = serialization.loads(line)

                level = obj.pop("level")
                msg = obj.pop("msg")

                level = log_levels.get(level.upper(), logging.INFO)
                logger.log(level, msg, **obj)
            except Exception:
                logger.info(line)

    thread = threading.Thread(target=drain, name=f"{name}-log-drain", daemon=True)
    thread.start()


def _stop_subprocess(proc: subprocess.Popen) -> None:
    """Terminate a subprocess, falling back to kill on timeout."""

    proc.terminate()

    try:
        proc.wait(timeout=SERVER_PROCESS_TERMINATION_TIMEOUT.total_seconds())
    except subprocess.TimeoutExpired:
        proc.kill()


def _resolve_port(port: int) -> int:
    """Shift to dev port range when using the default port in dev mode."""

    if is_dev_mode() and port == DAEMON_PORT:
        return DAEMON_DEV_PORT

    return port


def _backend_port(port: int) -> int:
    """Resolve the backend listen port (port + 1, behind Caddy or Vite)."""

    if is_dev_mode():
        return _resolve_port(port) + 1

    return port + 1


def _frontend_port(port: int) -> int:
    """Resolve the user-facing port (shifted in dev mode)."""

    return _resolve_port(port)


def _frontend_url(port: int) -> str:
    """Build the user-facing URL - HTTPS in production (Caddy TLS), HTTP in dev."""

    scheme = "http" if is_dev_mode() else "https"

    return f"{scheme}://localhost:{_frontend_port(port)}"


def _startup_banner(port: int) -> str:
    """Build the formatted startup banner with version and URL."""

    lines = f"""\
CLAUDEBOX

{LICENSE}

Revision {format_install_info(get_install_info())}

⚡️⚡️⚡️ Claudebox running on {_frontend_url(port)} ⚡️⚡️⚡️

"""

    return "\n" + wrap_box(lines) + "\n"
