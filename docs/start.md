# Start here

This page goes from installation to an agent answering a first message; most of the time goes on the first image build.

## Prerequisites

**Podman or Docker.** The installer neither installs a container runtime nor checks for one, and nothing works without it; other OCI runtimes are untested. Install one first; for podman, this confirms rootless mode works:

```bash
podman info
```

Git and bash are also needed. The installer fetches Python and Node through `uv` and `nvm` if they are missing.

## Install

```bash
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | bash
```

For Docker instead of Podman:

```bash
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | CLAUDEBOX_BACKEND=docker bash
```

This clones the library, builds the frontend and the container image, installs the `claudebox` CLI and the `claudeboxd` daemon, registers the daemon as a user service, and adds a timer that keeps the image current.

The image is built in layers, and the first build is the slow one, at five to fifteen minutes depending on network and CPU. Later runs reuse the cache.

## Authentication

```bash
claudebox run
```

The first launch opens the agent's own terminal interface for logging in. Credentials persist afterwards - per project when that project has a workspace marker, globally when it does not.

To log in without the interface, run `claudebox run -- claude auth login`. Its code prompt shows nothing while the code is pasted; `Enter` completes the login.

Without a login, the welcome page says the workspace has none, naming `claudebox run` as the step that adds one; a message sent anyway comes back as a failed turn saying the same.

## The interface

```
https://localhost:41820
```

The browser warns about the certificate, because the daemon sits behind Caddy with a self-signed certificate. Accepted once per browser, it stays accepted.

![The interface on first load: an empty chat with the message box at the bottom, waiting for a first message](images/start-welcome.png)

If nothing is served, the daemon is not running. Under systemd it was installed as a user service; without systemd - on macOS, for instance - start it with `claudeboxd`.

## The first message

A message typed into the box at the bottom and sent with `Enter` creates a session, starts its container, and becomes the session's first turn.

A question that touches the filesystem shows the isolation:

```
What files are in this directory?
```

The reply lists the working directory. That directory is mounted into the container at the same path it has outside, so the agent reads and writes the files there, and nothing above it.

![The first exchange: the question, the shell command the agent ran to answer it, and the reply listing the working directory](images/start-first-reply.png)

## Files on disk

A session's files are on disk, under `~/.claudebox/` by default:

| Path | Contents |
|---|---|
| `~/.claudebox/sessions/` | One directory per session - events, logs, state |
| `~/.claudebox/settings.toml` | Settings |
| `~/.claudebox/profile/` | The profile the installer copied |
| `~/.claudebox/logs/` | Daemon logs |

`touch .workspace` in a project root keeps that project's sessions apart from other projects': everything moves under `{project}/.claudebox/` instead. The [workspaces guide](guide/workspaces.md) covers it.

## Updates

Once a day the maintenance timer the installer added updates claudebox, rebuilds the image and prunes what old sessions leave behind; `claudebox update` does the update on demand. Either way the daemon restarts, and an open tab reloads itself onto the new version once its connection comes back.

## Uninstalling

```bash
# Stop and disable systemd units
systemctl --user disable --now claudebox-daemon.service claudebox-maintenance.timer claudebox-watchdog.timer
rm -rf ~/.config/systemd/user/claudebox-*
systemctl --user daemon-reload

# Remove CLI symlinks
rm -f ~/.local/bin/claudebox ~/.local/bin/claudeboxd

# Remove library, state, and credentials (irreversible)
rm -rf ~/.claudebox

# Remove containers and images
podman container prune -f --filter label=app=claudebox
podman image prune -f --filter label=app=claudebox
```

A project with a workspace marker keeps its own sessions and login under `{project}/.claudebox/`; delete that directory too to remove them.

## Related pages

- [Chat](features/chat.md) - the conversation view and its controls
- [Security](guide/security.md) - what the container can and cannot reach
- [Profiles](guide/profiles.md) - the prompt, hooks and skills an agent runs with
- [Configuration](guide/configuration.md) - mounts, ports, environment, editor integration
- [Troubleshooting](guide/troubleshooting.md) - what to check when a step above fails
