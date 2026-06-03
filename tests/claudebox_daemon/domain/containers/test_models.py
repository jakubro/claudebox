"""Tests for claudebox_daemon.domain.containers.models — container data models."""

from claudebox import serialization
from claudebox_daemon.domain.containers.models import Container


class TestContainer:
    """Test container data model."""

    def test_base_url(self):
        c = Container(id="c1", backend_id="abc", port=9090)
        assert c.base_url == "http://localhost:9090"

    def test_roundtrip_via_json(self):
        c = Container(id="c1", backend_id="abc", port=8080)
        json_str = serialization.dumps(c.asdict())
        data = serialization.loads(json_str)
        restored = Container.fromdict(data)
        assert restored.id == c.id
        assert restored.port == c.port
