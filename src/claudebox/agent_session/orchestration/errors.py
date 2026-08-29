"""Session orchestration domain exceptions - typed errors with HTTP status codes."""

from ...errors import ApiError


class SessionNotReady(ApiError):
    """Session not yet initialized."""

    status_code = 503
    error_key = "session_not_ready"


class SessionEntryNotFound(ApiError):
    """No registry entry for the given session id in this container.

    Distinct from session.models.SessionNotFound, which is about the on-disk session set.
    """

    status_code = 404
    error_key = "session_entry_not_found"


class ValidationError(ApiError):
    """Required field missing or invalid in request body."""

    status_code = 400

    def __init__(self, error_key: str, **context: str) -> None:
        self.error_key = error_key
        super().__init__(**context)


class AttachmentNotFound(ApiError):
    """Attachment file not in session directory."""

    status_code = 404
    error_key = "attachment_not_found"


class AttachmentInvalid(ApiError):
    """Attachment data invalid or exceeds size limit."""

    status_code = 400

    def __init__(self, error_key: str, **context: str) -> None:
        self.error_key = error_key
        super().__init__(**context)


class ToolOutputNotFound(ApiError):
    """Tool output file not found for session/tool_use_id."""

    status_code = 404
    error_key = "tool_output_not_found"


class McpServerProtected(ApiError):
    """Reconnect/toggle named claudebox's own in-process sibling-session server.

    Hidden from the MCP panel for the same reason: an agent must not lose its delegation tools.
    """

    status_code = 400
    error_key = "mcp_server_protected"

    def __init__(self, server_name: str) -> None:
        super().__init__(server_name=server_name)
