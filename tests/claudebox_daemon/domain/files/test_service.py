"""Tests for claudebox_daemon.domain.files.service - media types of the images it resolves."""

from __future__ import annotations

import pytest

from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.files import FileService, UnsupportedMediaType
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


@pytest.fixture
def service(tmp_path):
    for name in ["shot.PNG", "logo.svg", "photo.jpeg", "data.json"]:
        (tmp_path / name).write_bytes(b"x")

    return FileService(
        RegisteredWorkspace(id="ws", path=tmp_path),
        executor=ObservedPool(1, name="listing"),
    )


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("name", "media_type"),
    [("shot.PNG", "image/png"), ("logo.svg", "image/svg+xml"), ("photo.jpeg", "image/jpeg")],
)
async def test_an_image_resolves_with_its_media_type(service, tmp_path, name, media_type):
    path, served_as = await service.resolve_image(name, None)

    assert path == (tmp_path / name).resolve()
    assert served_as == media_type


@pytest.mark.anyio
async def test_a_non_image_is_refused(service):
    with pytest.raises(UnsupportedMediaType):
        await service.resolve_image("data.json", None)
