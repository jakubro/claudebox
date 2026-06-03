"""Tests for rotating file handler in core logging module."""

import logging
import logging.handlers
from pathlib import Path

from claudebox.core.logging import use_rotating_log_file


class TestUseRotatingLogFile:
    """Tests for use_rotating_log_file()."""

    def test_creates_rotating_file_handler(self, tmp_path: Path) -> None:
        """Verify handler type is RotatingFileHandler and file is created."""

        log_path = tmp_path / "logs" / "test.log"
        use_rotating_log_file(log_path)

        root = logging.getLogger()
        rotating_handlers = [
            h
            for h in root.handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) == log_path
        ]
        assert len(rotating_handlers) == 1
        assert log_path.exists()

        # Cleanup
        root.removeHandler(rotating_handlers[0])
        rotating_handlers[0].close()

    def test_rotation_parameters(self, tmp_path: Path) -> None:
        """Verify maxBytes and backupCount are set correctly."""

        log_path = tmp_path / "test.log"
        use_rotating_log_file(log_path, max_bytes=5_000_000, backup_count=3)

        root = logging.getLogger()
        handler = next(
            h
            for h in root.handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) == log_path
        )
        assert handler.maxBytes == 5_000_000
        assert handler.backupCount == 3

        # Cleanup
        root.removeHandler(handler)
        handler.close()

    def test_default_parameters(self, tmp_path: Path) -> None:
        """Verify default maxBytes (10 MB) and backupCount (5)."""

        log_path = tmp_path / "test.log"
        use_rotating_log_file(log_path)

        root = logging.getLogger()
        handler = next(
            h
            for h in root.handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) == log_path
        )
        assert handler.maxBytes == 10_485_760
        assert handler.backupCount == 5

        # Cleanup
        root.removeHandler(handler)
        handler.close()

    def test_coexists_with_use_log_file(self, tmp_path: Path) -> None:
        """Verify rotating handler coexists with regular file handler."""

        from claudebox.core.logging import use_log_file

        rotating_path = tmp_path / "rotating.log"
        session_path = tmp_path / "session.log"

        use_rotating_log_file(rotating_path)
        use_log_file(session_path)

        root = logging.getLogger()
        rotating_handlers = [
            h
            for h in root.handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) == rotating_path
        ]
        file_handlers = [
            h
            for h in root.handlers
            if isinstance(h, logging.FileHandler)
            and not isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) == session_path
        ]
        assert len(rotating_handlers) == 1
        assert len(file_handlers) == 1

        # Cleanup
        for h in rotating_handlers + file_handlers:
            root.removeHandler(h)
            h.close()

    def test_replaces_previous_rotating_handler(self, tmp_path: Path) -> None:
        """Verify calling use_rotating_log_file twice replaces the first handler."""

        path1 = tmp_path / "first.log"
        path2 = tmp_path / "second.log"

        use_rotating_log_file(path1)
        use_rotating_log_file(path2)

        root = logging.getLogger()
        rotating_handlers = [
            h
            for h in root.handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
            and Path(h.baseFilename) in (path1, path2)
        ]
        assert len(rotating_handlers) == 1
        assert Path(rotating_handlers[0].baseFilename) == path2

        # Cleanup
        root.removeHandler(rotating_handlers[0])
        rotating_handlers[0].close()
