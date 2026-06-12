"""Session orchestration domain exceptions - typed errors with HTTP status codes."""

from ...errors import ApiError


class SessionNotReady(ApiError):
    """Session not yet initialized."""

    status_code = 503
    error_key = "session_not_ready"


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
