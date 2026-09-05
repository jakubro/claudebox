"""Tests for claudebox_daemon.domain.sessions.links - link message allowlist matching."""

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
