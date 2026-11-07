"""Tests for claudebox.agent_session.orchestration.attachments - path resolution and MIME inference."""

from __future__ import annotations

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


class TestAttachmentInline:
    """Only raster pictures are shown inline on their own address; every other file downloads."""

    @pytest.mark.parametrize("name", ["a.png", "a.PNG", "a.jpg", "a.jpeg", "a.gif", "a.webp"])
    def test_a_raster_picture_is_inline(self, tmp_workspace, name):
        assert _resolved(tmp_workspace, name).inline is True

    @pytest.mark.parametrize("name", ["a.pdf", "a.svg", "a.bin"])
    def test_anything_else_is_not(self, tmp_workspace, name):
        assert _resolved(tmp_workspace, name).inline is False

    @pytest.mark.parametrize("name", ["a.png", "a.jpg", "a.gif", "a.webp"])
    def test_the_proxy_keeps_every_inline_type_inline(self, tmp_workspace, name):
        from claudebox.core.http import INLINE_MEDIA_TYPES

        assert _resolved(tmp_workspace, name).media_type in INLINE_MEDIA_TYPES


def _resolved(tmp_workspace, name: str) -> AttachmentInfo:
    ws = Workspace(start_dir=tmp_workspace)
    attachments = ws.ensure_session("sid").path / "attachments"
    attachments.mkdir(parents=True, exist_ok=True)
    (attachments / name).write_bytes(b"fake")

    return AttachmentService(ws).resolve("sid", name)
