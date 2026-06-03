"""Per-workspace service — isolated container and session orchestration."""

from typing import TYPE_CHECKING

from claudebox import Broadcaster, ClaudeRuntime, Config, get_logger, serialization
from .models import RegisteredWorkspace


if TYPE_CHECKING:
    from ..boards import BoardService
    from ..containers import ContainerProxyClient, ContainerService
    from ..sessions import SessionService
    from ..ui_state import UIStateService


class WorkspaceService:
    """Per-workspace orchestrator; sub-services are None when the workspace dir is missing."""

    def __init__(
        self,
        workspace: RegisteredWorkspace,
        events: Broadcaster,
        proxy: "ContainerProxyClient",
    ):
        """Load workspace config and initialize sub-services when the workspace dir exists."""

        from ..boards import BoardService
        from ..containers import ContainerService
        from ..sessions import SessionService
        from ..ui_state import UIStateService

        self._logger = get_logger(__name__)
        self._config = Config.load(workspace.path)

        self.workspace: RegisteredWorkspace = workspace

        self._ui_state: UIStateService | None = None
        self._container_service: ContainerService | None = None
        self._session_service: SessionService | None = None
        self._board_service: BoardService | None = None

        if not self.workspace.available:
            self._logger.warning("Workspace directory unavailable", **self._log_context)
            return

        self._ui_state = UIStateService(workspace)

        self._container_service = ContainerService(
            workspace=workspace,
            events=events,
            config=self._config,
            proxy=proxy,
        )

        self._session_service = SessionService(
            workspace=workspace,
            containers=self._container_service,
            events=events,
        )

        self._board_service = BoardService(
            workspace=workspace,
            sessions=self._session_service,
            containers=self._container_service,
            events=events,
        )

    # Sub-service access
    # ----------------------------------------------------------------------------------------------

    @property
    def ui_state(self) -> "UIStateService":
        self._require_available("ui_state")
        assert self._ui_state is not None
        return self._ui_state

    @property
    def container_service(self) -> "ContainerService":
        self._require_available("container_service")
        assert self._container_service is not None
        return self._container_service

    @property
    def session_service(self) -> "SessionService":
        self._require_available("session_service")
        assert self._session_service is not None
        return self._session_service

    @property
    def board_service(self) -> "BoardService":
        self._require_available("board_service")
        assert self._board_service is not None
        return self._board_service

    def _require_available(self, accessor: str) -> None:
        if not self.workspace.available:
            raise RuntimeError(
                f"workspace {self.workspace.id!r} is unavailable; .{accessor} cannot be used"
            )

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Start container and session services if workspace is available."""

        self._logger.debug("Starting workspace service...", **self._log_context)

        if self.workspace.available:
            await self.container_service.start()
            await self.session_service.start()
            await self.board_service.start()

        self._logger.info("Workspace service started", **self._log_context)

    async def stop(self) -> None:
        """Stop board, session, and container services."""

        self._logger.debug("Stopping workspace service...", **self._log_context)

        if self.workspace.available:
            await self.board_service.stop()
            await self.session_service.stop()
            await self.container_service.stop()

        self._logger.info("Workspace service stopped", **self._log_context)

    # Slash Commands
    # ----------------------------------------------------------------------------------------------

    def list_workspace_commands(self) -> dict | None:
        """Return filesystem-discovered slash commands and skills, or None when the runtime lacks skills support."""

        if not ClaudeRuntime.CAPABILITIES.supports_skills:
            return None

        profile = self._config.profile
        skills = ClaudeRuntime.get_skills(
            commands_dir=(profile / "commands") if profile else None,
            skills_dir=(profile / "skills") if profile else None,
        )
        custom = [serialization.serialize(skill) for skill in skills]
        return {"custom": custom, "mcp": [], "builtin": []}

    # Misc
    # ----------------------------------------------------------------------------------------------

    @property
    def _log_context(self) -> dict:
        return {
            "workspace": {"id": self.workspace.id, "path": self.workspace.path},
        }
