"""Container lifecycle management: config, build, run, and backend abstraction."""

from .local import LocalRuntime
from .runtime import ContainerRuntime
from ..config import Config


def create_runtime(config: Config | None = None, *, verbose: bool = False):
    """Create the appropriate container runtime based on config.

    Returns LocalRuntime when backend is "local", ContainerRuntime otherwise.
    """

    config = config or Config.load()

    if config.backend == "local":
        return LocalRuntime(config=config, verbose=verbose)
    else:
        return ContainerRuntime(config=config, verbose=verbose)
