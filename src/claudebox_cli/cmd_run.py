"""Handler for the ``run`` verb - launch agent session in container."""

import argparse


NAME = "run"
ORDER = 10
DESCRIPTION = "Launch agent session in container"
EPILOG = """\
Examples:
  claudebox run                  launch interactive agent session
  claudebox run -- --resume      resume the most recent agent conversation
  claudebox run -- -p "prompt"   run a non-interactive prompt through the agent

Arguments:
  Everything after `--` is forwarded to the agent wrapper inside the container.

Notes:
  The project root is found by walking up for a `.workspace` marker, falling back to
  the current directory when there is none - no error, no prompt, and no automatic
  registration with the daemon.
"""


def register(parser: argparse.ArgumentParser) -> None:
    """Add REMAINDER agent_args."""

    parser.add_argument(
        "agent_args",
        nargs=argparse.REMAINDER,
        help="Arguments forwarded to the agent (place after `--`)",
    )


def handle(args: argparse.Namespace) -> int:
    """Launch an agent session and return the container exit code."""

    # Deferred: pulls structlog and the container backend, which the cold path must not pay for.
    from claudebox import ContainerRuntime

    agent_args = _strip_double_dash(args.agent_args or [])

    runtime = ContainerRuntime(verbose=args.verbose)

    return runtime.run(args=agent_args, kind="agent")


def _strip_double_dash(agent_args: list[str]) -> list[str]:
    """Drop the leading ``--`` separator argparse REMAINDER preserves."""

    if agent_args and agent_args[0] == "--":
        return agent_args[1:]

    return agent_args
