"""Handler for the ``run`` verb - launch agent session in container."""

import argparse

from claudebox import ContainerRuntime


NAME = "run"
ORDER = 10
DESCRIPTION = "Launch agent session in container"
EPILOG = """\
examples:
  claudebox run                  launch interactive agent session
  claudebox run -- --resume      resume the most recent agent conversation
  claudebox run -- -p "prompt"   run a non-interactive prompt through the agent

passing extra arguments:
  Arguments after "--" are forwarded to the agent wrapper inside the container.

project detection:
  Walks up the directory tree looking for a .workspace marker to find the
  project root. Falls back to cwd when no marker is present (no error, no
  prompt, no auto-registration with the daemon).
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

    agent_args = _strip_double_dash(args.agent_args or [])

    runtime = ContainerRuntime(verbose=args.verbose)

    return runtime.run(args=agent_args, kind="agent")


def _strip_double_dash(agent_args: list[str]) -> list[str]:
    """Drop the leading ``--`` separator argparse REMAINDER preserves."""

    if agent_args and agent_args[0] == "--":
        return agent_args[1:]

    return agent_args
