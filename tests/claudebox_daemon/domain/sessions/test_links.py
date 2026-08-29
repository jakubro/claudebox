"""Tests for claudebox_daemon.domain.sessions.links - link message allowlist matching."""

from claudebox_daemon.domain.sessions.links import resolve_link_messages


def test_full_match_anchoring_rejects_a_prefix_match():
    delivered, blocked = resolve_link_messages(
        ["/scope claudebox; rm -rf /"],
        [r"/scope \S+"],
    )

    assert delivered == []
    assert blocked == ["/scope claudebox; rm -rf /"]


def test_full_match_anchoring_accepts_an_exact_match():
    delivered, blocked = resolve_link_messages(["/scope claudebox"], [r"/scope \S+"])

    assert delivered == ["/scope claudebox"]
    assert blocked == []


def test_empty_allowlist_rejects_every_message():
    delivered, blocked = resolve_link_messages(["/scope claudebox"], [])

    assert delivered == []
    assert blocked == ["/scope claudebox"]


def test_all_or_nothing_across_a_list():
    delivered, blocked = resolve_link_messages(
        ["/scope claudebox", "/danger"],
        [r"/scope \S+"],
    )

    assert delivered == []
    assert blocked == ["/scope claudebox", "/danger"]


def test_invalid_regex_is_skipped_without_disabling_the_check():
    delivered, blocked = resolve_link_messages(
        ["/scope claudebox"],
        [r"(unclosed", r"/scope \S+"],
    )

    assert delivered == ["/scope claudebox"]
    assert blocked == []


def test_blank_messages_are_dropped_and_counted_as_neither():
    delivered, blocked = resolve_link_messages(["", "   "], [r"/scope \S+"])

    assert delivered == []
    assert blocked == []


def test_blank_entries_are_stripped_before_evaluating_the_rest():
    delivered, blocked = resolve_link_messages(["", "/scope claudebox"], [r"/scope \S+"])

    assert delivered == ["/scope claudebox"]
    assert blocked == []
