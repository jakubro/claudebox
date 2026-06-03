"""Tests for claudebox.agent_session.orchestration.attachments — path resolution and MIME inference."""

import pytest

from claudebox.agent_session.orchestration.attachments import AttachmentInfo, AttachmentService
from claudebox.agent_session.orchestration.errors import AttachmentNotFound
from claudebox.workspace import Workspace


class TestAttachmentServiceResolve:
    """Test attachment path resolution and MIME inference."""

    def test_resolves_png(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("sid")
        attachments_dir = session.path / "attachments"
        attachments_dir.mkdir(parents=True, exist_ok=True)
        (attachments_dir / "abc_photo.png").write_bytes(b"fake")

        svc = AttachmentService(ws)
        info = svc.resolve("sid", "abc_photo.png")

        assert isinstance(info, AttachmentInfo)
        assert info.path == attachments_dir / "abc_photo.png"
        assert info.media_type == "image/png"

    def test_resolves_jpeg(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("sid")
        attachments_dir = session.path / "attachments"
        attachments_dir.mkdir(parents=True, exist_ok=True)
        (attachments_dir / "photo.jpg").write_bytes(b"fake")

        svc = AttachmentService(ws)
        info = svc.resolve("sid", "photo.jpg")
        assert info.media_type == "image/jpeg"

    def test_resolves_pdf(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("sid")
        attachments_dir = session.path / "attachments"
        attachments_dir.mkdir(parents=True, exist_ok=True)
        (attachments_dir / "doc.pdf").write_bytes(b"fake")

        svc = AttachmentService(ws)
        info = svc.resolve("sid", "doc.pdf")
        assert info.media_type == "application/pdf"

    def test_unknown_extension_defaults_to_octet_stream(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("sid")
        attachments_dir = session.path / "attachments"
        attachments_dir.mkdir(parents=True, exist_ok=True)
        (attachments_dir / "data.xyz").write_bytes(b"fake")

        svc = AttachmentService(ws)
        info = svc.resolve("sid", "data.xyz")
        assert info.media_type == "application/octet-stream"

    def test_missing_file_raises(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        svc = AttachmentService(ws)

        with pytest.raises(AttachmentNotFound):
            svc.resolve("sid", "nonexistent.png")
