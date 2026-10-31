# Start here

From nothing to an agent answering a message - most of the time goes on the first image build.

## One prerequisite you have to supply

**Podman or Docker.** The installer neither installs a container runtime nor checks that you have one, and nothing works without it; other OCI runtimes are untested. Install one first, and for podman confirm rootless mode works:

```bash
podman info
```

Also needed, and almost certainly already present: git and bash. Python and Node are handled for you - the installer fetches them through `uv` and `nvm` if they are missing.

## Install

```bash
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | bash
```

For Docker instead of Podman:

```bash
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | CLAUDEBOX_BACKEND=docker bash
```

This clones the library, builds the frontend and the container image, installs the `claudebox` CLI and the `claudeboxd` daemon, registers the daemon as a user service, and adds a timer that keeps the image current.

The image is built in layers, and the first build is the slow one - expect five to fifteen minutes depending on network and CPU. Later runs reuse the cache.

## Authenticate, once

```bash
claudebox run
```

The first launch opens the agent's own terminal interface, where you log in. Credentials persist afterwards - per project when that project has a workspace marker, globally when it does not.

To log in without the interface, run `claudebox run -- claude auth login`. Its code prompt shows nothing as you paste: press `Enter` and the login completes.

Skip this and the welcome page says the workspace has no login, naming `claudebox run` as the step that adds one; a message sent anyway comes back as a failed turn saying the same.

## Open the interface

```
https://localhost:41820
```

Your browser will warn about the certificate. That is expected: the daemon sits behind Caddy with a self-signed certificate. Accept it once per browser and it stays accepted.

![The interface on first load: an empty chat with the message box at the bottom, waiting for a first message](images/start-welcome.png)

If nothing is served, the daemon is not running. Under systemd it was installed as a user service; without systemd - on macOS, for instance - start it yourself with `claudeboxd`.

## Send the first message

Type into the box at the bottom and press `Enter`. That creates a session, starts its container, and sends your message as its first turn.

Ask it something that touches the filesystem, because that is what shows you the isolation is real:

```
What files are in this directory?
```

The reply lists your working directory. That directory is mounted into the container at the same path it has outside, so the agent reads and writes the real thing - and nothing above it.

![The first exchange: the question, the shell command the agent ran to answer it, and the reply listing the working directory](images/start-first-reply.png)

## Where it all went

Everything for the session is on disk, under `~/.claudebox/` by default:

| Path | Contents |
|---|---|
| `~/.claudebox/sessions/` | One directory per session - events, logs, state |
| `~/.claudebox/settings.toml` | Your settings |
| `~/.claudebox/profile/` | The profile the installer copied for you |
| `~/.claudebox/logs/` | Daemon logs |

To keep one project's sessions out of another's, `touch .workspace` in the project root and everything moves under `{project}/.claudebox/` instead. That is the [workspaces guide](guide/workspaces.md).

## Keeping it current

Once a day the maintenance timer the installer added updates claudebox, rebuilds the image and prunes what old sessions leave behind; `claudebox update` does the update on demand. Either way the daemon restarts, and an open tab reloads itself onto the new version once its connection comes back.

## Removing it

```bash
# Stop and disable systemd units
systemctl --user disable --now claudebox-daemon.service claudebox-maintenance.timer claudebox-watchdog.timer
rm -f ~/.config/systemd/user/claudebox-*
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

## Next

- [Chat](features/chat.md) - what the interface gives you that a terminal does not
- [Security](guide/security.md) - what the container can and cannot reach
- [Profiles](guide/profiles.md) - the prompt, hooks and skills your agent runs with
- [Configuration](guide/configuration.md) - mounts, ports, environment, editor integration
- [Troubleshooting](guide/troubleshooting.md) - if any step above did not go as written
