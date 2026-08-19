#!/bin/bash
# Podman-in-podman toolchain, gated at runtime by [containers] nested (see run.py).
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
# runroot is required too - without it, root-invoked podman fails with `runroot must be set`.
mkdir -p /etc/containers
cat >/etc/containers/storage.conf <<'EOF'
[storage]
driver = "overlay"
graphroot = "/var/lib/containers-storage"
runroot = "/run/containers/storage"

[storage.options]
mount_program = "/usr/bin/fuse-overlayfs"
mountopt = "nodev,fsync=0"
EOF

# No systemd/journald in-container: host namespaces + cgroupfs avoid podman's dbus/journald defaults.
# volumes (not mounts - ignored by podman build) rebind the kernel filesystems below; crun
# cannot mount fresh copies of them inside this already-containerized rootfs.
cat >/etc/containers/containers.conf <<'EOF'
[containers]
netns = "host"
userns = "host"
ipcns = "host"
utsns = "host"
cgroupns = "host"
cgroups = "disabled"
log_driver = "k8s-file"
volumes = [
  "/proc:/proc",
  "/dev/pts:/dev/pts",
  "/dev/mqueue:/dev/mqueue",
  "/dev/shm:/dev/shm",
  "/sys:/sys:ro",
]

[engine]
cgroup_manager = "cgroupfs"
events_logger = "file"
runtime = "crun"
EOF

# Identity range for the toolchain's userns. Must start at 1 - any gap shifts every id.
# daemon covers uid 1, what podman resolves given _CONTAINERS_ROOTLESS_UID=1 (set in Containerfile);
# root covers the real caller, which newuidmap validates the request against separately.
echo "daemon:1:65535" >>/etc/subuid
echo "root:1:65535" >>/etc/subuid
echo "daemon:1:65535" >>/etc/subgid
echo "root:1:65535" >>/etc/subgid

# podman needs _CONTAINERS_ROOTLESS_UID set (see Containerfile); the standalone buildah CLI
# cannot mount its own store with it, so it gets a wrapper that strips the var.
mkdir -p /usr/local/bin
cat >/usr/local/bin/buildah <<'EOF'
#!/bin/bash
exec env -u _CONTAINERS_ROOTLESS_UID /usr/bin/buildah "$@"
EOF
chmod 0755 /usr/local/bin/buildah
