"""Validation rules on typed AgentEvent payloads - fail-loud on contract violations."""

import pytest

from claudebox.agent_session.events import SystemInitData, SystemInitPayload


class TestSystemInitPayloadSessionId:
    """``SystemInitPayload.session_id`` must be non-empty - empty signals a contract violation."""

    def test_constructs_with_valid_session_id(self):
        payload = SystemInitPayload(subtype="init", session_id="abc-123", model=None)

        assert payload.session_id == "abc-123"

    def test_raises_on_empty_session_id(self):
        with pytest.raises(ValueError, match="session_id must be non-empty"):
            SystemInitPayload(subtype="init", session_id="", model=None)

    def test_raises_on_empty_session_id_with_full_init_data(self):
        """Validator runs regardless of other fields being populated."""

        with pytest.raises(ValueError, match="session_id must be non-empty"):
            SystemInitPayload(
                subtype="init",
                session_id="",
                model="claude-opus",
                data=SystemInitData(slash_commands=["/help"]),
            )
