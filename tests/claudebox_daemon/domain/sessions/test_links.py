"""Tests for claudebox_daemon.domain.sessions.links - link message allowlist matching."""

from __future__ import annotations

from claudebox_daemon.domain.sessions.links import resolve_link_messages


def test_full_match_anchoring_rejects_a_prefix_match():
    delivered, blocked = resolve_link_messages(
        ["/greet ada; rm -rf /"],
        [r"/greet \S+"],
    )

    assert delivered == []
    assert blocked == ["/greet ada; rm -rf /"]


def test_full_match_anchoring_accepts_an_exact_match():
    delivered, blocked = resolve_link_messages(["/greet ada"], [r"/greet \S+"])

    assert delivered == ["/greet ada"]
    assert blocked == []


def test_a_wildcard_spans_the_line_breaks_of_a_multi_line_message():
    delivered, blocked = resolve_link_messages(["/greet ada\nsecond line"], [r"/greet .*"])

    assert delivered == ["/greet ada\nsecond line"]
    assert blocked == []


def test_a_multi_line_message_still_fails_a_pattern_its_first_line_misses():
    delivered, blocked = resolve_link_messages(["/danger\n/greet ada"], [r"/greet .*"])

    assert delivered == []
    assert blocked == ["/danger\n/greet ada"]


def test_empty_allowlist_rejects_every_message():
    delivered, blocked = resolve_link_messages(["/greet ada"], [])

    assert delivered == []
    assert blocked == ["/greet ada"]


def test_all_or_nothing_across_a_list():
    delivered, blocked = resolve_link_messages(
        ["/greet ada", "/danger"],
        [r"/greet \S+"],
    )

    assert delivered == []
    assert blocked == ["/greet ada", "/danger"]


def test_invalid_regex_is_skipped_without_disabling_the_check():
    delivered, blocked = resolve_link_messages(
        ["/greet ada"],
        [r"(unclosed", r"/greet \S+"],
    )

    assert delivered == ["/greet ada"]
    assert blocked == []


def test_blank_messages_are_dropped_and_counted_as_neither():
    delivered, blocked = resolve_link_messages(["", "   "], [r"/greet \S+"])

    assert delivered == []
    assert blocked == []


def test_blank_entries_are_stripped_before_evaluating_the_rest():
    delivered, blocked = resolve_link_messages(["", "/greet ada"], [r"/greet \S+"])

    assert delivered == ["/greet ada"]
    assert blocked == []
