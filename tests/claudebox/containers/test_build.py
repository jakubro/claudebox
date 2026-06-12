"""Tests for claudebox.containers.build - build argument generation."""

import pytest

from claudebox.constants import CONTAINER_IMAGE_NAME
from claudebox.containers.build import get_image_build_args
from claudebox.containers.models import ImageBuildMode


# --- get_build_args ---


class TestGetBuildArgs:
    """Test build command argument generation."""

    def test_containerfile_and_tag(self, tmp_path):
        args = list(get_image_build_args(tmp_path, None))
        assert "--file" in args
        assert tmp_path / "Containerfile" in args
        assert "--tag" in args
        assert CONTAINER_IMAGE_NAME in args
        assert args[-1] == tmp_path

    def test_update_mode_adds_build_arg(self, tmp_path):
        args = list(get_image_build_args(tmp_path, ImageBuildMode.UPDATE))
        assert "--build-arg" in args
        build_arg_values = [args[i + 1] for i, a in enumerate(args) if a == "--build-arg"]
        assert any("CLAUDEBOX_FORCE_AGENT_UPDATE=" in v for v in build_arg_values)

    def test_rebuild_mode_adds_no_cache(self, tmp_path):
        args = list(get_image_build_args(tmp_path, ImageBuildMode.REBUILD))
        assert "--no-cache" in args

    @pytest.mark.parametrize("mode", [ImageBuildMode.BUILD, None])
    def test_plain_mode_no_extra_flags(self, tmp_path, mode):
        args = list(get_image_build_args(tmp_path, mode))
        assert "--no-cache" not in args
        assert "--build-arg" not in args
