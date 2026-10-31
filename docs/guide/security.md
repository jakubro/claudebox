# Security

The container is the trust boundary. Inside it the agent runs with every permission; what keeps the rest of your machine safe is what the container is given and what it is not.

## Inside the container

A session starts with the agent's permission checks bypassed, so it can execute anything: it reads and writes the workspace, reaches the network, and installs packages. Containers of its own are off unless the workspace sets `[containers] nested = true`, and even then they run inside the session container's namespaces, invisible to the host and gone when the session ends - see [nested containers](../features/nested-containers.md).

## What it can write on the host

The workspace is mounted read-write at the same path it has on the host. Beyond it, a container writes the data of every session in the workspace under `.claudebox/sessions/`, the agent's configuration under `.claudebox/fs/root/` - its login among it - and whatever you mount under `[mounts]`, which is read-write. An agent can therefore read and rewrite the other sessions' transcripts. Directories with no `.workspace` marker all share the session data and login under `~/.claudebox/`.

Three mounts are read-only, because a write to any of them would reach past the session:

| Mount | Why it is read-only |
|---|---|
| The claudebox library | The host runs that code: `claudeboxd` starts from it and the `claudebox` command links into it |
| The profile | Every workspace without a profile of its own shares it, and its hooks run as root in every container |
| The workspace's `.claudebox/settings.toml` | It decides the next container's mounts, ports, network and environment; you edit it on the host, and the next session picks the edit up |

A session started in a directory with no `.workspace` marker treats that directory as its workspace, and its settings file is protected the same way.

## What is reachable from outside

| Surface | Reachable from |
|---|---|
| The web UI, through Caddy on port 41820 with a self-signed certificate | Every interface of the host, with no authentication |
| A session's own API - the port that takes prompts and streams the transcript | The host's loopback, and the workspace's other session containers, with no authentication |
| Ports listed under `[ports]` | Every interface of the host |

Anyone who can reach port 41820 can drive every session, and an agent can drive the other sessions of its workspace through their own API - that is how one session asks another. On a network you do not control, bind the daemon to localhost, firewall the port, or put an authenticating reverse proxy in front of it.

## Credentials

The agent's login lives in `.claudebox/fs/root/.claude/.credentials.json` - under the project for a workspace with a marker, under `~/.claudebox/` otherwise - and an API key set under `[env]` reaches the container's environment. Treat both as you would any other API token. Model providers under LangGraph take their keys from the environment the same way.

Claudebox itself sends no telemetry.

## Limits

- One user per host. There is no isolation between users beyond what rootless podman gives.
- The daemon is meant for the machine it runs on; it has no access control of its own.
- Podman and Docker are the supported container runtimes.

## Details

- [Workspaces](workspaces.md) - markers, registration and what lands where
- [Configuration reference](../reference/configuration.md) - `[mounts]`, `[ports]`, `[network]`, `[containers]` and `[env]`
- [Nested containers](../features/nested-containers.md)
