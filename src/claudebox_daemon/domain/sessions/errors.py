"""Session domain exceptions."""

from __future__ import annotations

from ..errors import DaemonError


class SessionNotFound(DaemonError):
    """Session ID does not exist on workspace disk."""

    status_code = 404
    error_key = "session_not_found"


class SessionContainerUnavailable(DaemonError):
    """No running container for a session a shared-container operation needs."""

    status_code = 409
    error_key = "session_container_unavailable"


class SessionContainerInvalidId(DaemonError):
    """A container's create response named a session id that fails validation."""

    status_code = 502
    error_key = "session_container_invalid_id"


class SessionContainerCreateFailed(DaemonError):
    """A container's create endpoint answered with a non-2xx status."""

    status_code = 502
    error_key = "session_container_create_failed"


class SessionContainerResumeFailed(DaemonError):
    """A container answered a request to start a session in it with a non-2xx status."""

    status_code = 502
    error_key = "session_container_resume_failed"


class SessionTranscriptMissing(DaemonError):
    """A Claude session to fork has no transcript, so a fork of it could never start."""

    status_code = 409
    error_key = "session_transcript_missing"
