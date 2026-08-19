"""Tests for argcomplete completers - must never raise out of the completion subprocess."""

from unittest.mock import patch

from claudebox_cli._completers import complete_container_target


class TestCompleteContainerTarget:
    """complete_container_target degrades to ["all"] without raising on failure."""

    def test_degrades_to_all_when_daemon_query_fails(self) -> None:
        with patch(
            "claudebox_cli._completers._container_short_ids",
            side_effect=RuntimeError("daemon unreachable"),
        ):
            assert complete_container_target() == ["all"]

    def test_prefix_filters_the_fallback_all_entry(self) -> None:
        with patch(
            "claudebox_cli._completers._container_short_ids",
            side_effect=RuntimeError("daemon unreachable"),
        ):
            assert complete_container_target(prefix="x") == []

    def test_includes_resolved_short_ids_alongside_all(self) -> None:
        with patch(
            "claudebox_cli._completers._container_short_ids",
            return_value=["abc123456789"],
        ):
            assert complete_container_target() == ["all", "abc123456789"]
