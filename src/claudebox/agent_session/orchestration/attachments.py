"""Attachment service — path resolution and MIME inference for session attachments."""

from dataclasses import dataclass
from pathlib import Path

from .errors import AttachmentNotFound
from ...constants import SESSION_ATTACHMENTS_DIR
from ...workspace import Workspace


MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
}


@dataclass
class AttachmentInfo:
    """Resolved attachment with path and inferred media type.

    Attributes:
        path: Absolute path to the attachment file.
        media_type: MIME type inferred from file extension.
    """

    path: Path
    media_type: str


class AttachmentService:
    """Resolve and validate session attachment files.

    Attributes:
        _workspace: Workspace for resolving session directories.
    """

    def __init__(self, workspace: Workspace):
        self._workspace = workspace

    def resolve(self, session_id: str, filename: str) -> AttachmentInfo:
        """Resolve attachment path and infer media type.

        Raises AttachmentNotFound if the file does not exist.
        """

        session = self._workspace.ensure_session(session_id)
        path = session.path / SESSION_ATTACHMENTS_DIR / filename

        if not path.exists():
            raise AttachmentNotFound(session_id=session_id, filename=filename)

        media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")

        return AttachmentInfo(path=path, media_type=media_type)
