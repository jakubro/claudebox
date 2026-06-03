"""Container data models and enumerations."""

import enum


class ImageBuildMode(enum.Enum):
    """Container image build strategies.

    Members:
        BUILD: Reuse cached layers when building the image.
        UPDATE: Rebuild only the agent layer, reusing other cached layers.
        REBUILD: Full rebuild with no cache, rebuilding all layers from scratch.
    """

    BUILD = enum.auto()
    UPDATE = enum.auto()
    REBUILD = enum.auto()
