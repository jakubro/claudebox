#!/bin/bash
# Rootless podman-in-podman toolchain, gated at runtime by [containers] nested (see run.py).
set -euo pipefail

apt-get install -y --no-install-recommends \
  buildah \
  conmon \
  containernetworking-plugins \
  crun \
  fuse-overlayfs \
  passt \
  podman \
  podman-compose \
  podman-docker \
  slirp4netns \
  uidmap

# fuse-overlayfs sidesteps overlay-on-overlay on this image's own overlay rootfs.
# graphroot must match CONTAINER_NESTED_GRAPHROOT in constants.py (run.py's --tmpfs mount).
mkdir -p /etc/containers
cat >/etc/containers/storage.conf <<'EOF'
[storage]
driver = "overlay"
graphroot = "/var/lib/containers-storage"

[storage.options]
mount_program = "/usr/bin/fuse-overlayfs"
mountopt = "nodev,fsync=0"
EOF

# No systemd/journald in-container: host namespaces + cgroupfs avoid podman's dbus/journald defaults.
cat >/etc/containers/containers.conf <<'EOF'
[containers]
netns = "host"
userns = "host"
ipcns = "host"
utsns = "host"
cgroupns = "host"
cgroups = "disabled"
log_driver = "k8s-file"

[engine]
cgroup_manager = "cgroupfs"
events_logger = "file"
runtime = "crun"
EOF

# Subordinate id range for the inner rootless userns, carved from the outer container's own uid mapping.
echo "podman:10000:65536" >>/etc/subuid
echo "podman:10000:65536" >>/etc/subgid

# podman/buildah pick rootless-vs-rootful by euid; outer agent stays root, so
# container tools run as this dedicated non-root user via the shims below.
useradd -m podman

# podman's fallback XDG_RUNTIME_DIR does a non-recursive mkdir on first use; pre-create it.
runuser -u podman -- mkdir -p /home/podman/rundir

mkdir -p /usr/local/bin
for tool in podman docker buildah podman-compose; do
  cat >"/usr/local/bin/$tool" <<EOF
#!/bin/bash
exec runuser -u podman -- /usr/bin/$tool "\$@"
EOF
  chmod 0755 "/usr/local/bin/$tool"
done
