#!/bin/sh
# Mission Control container entrypoint.
#
# Runs as root, fixes data-dir ownership and docker-socket access, then
# drops to uid 1000 (node) before exec'ing the Next.js server. This
# decouples us from the named volume's pre-existing ownership — useful
# when migrating between deploys (e.g. the original image used uid 1001,
# this one uses uid 1000).
set -e

# Ensure data dir exists and is writable by the runtime user.
mkdir -p /app/data
chown -R node:node /app/data

# Add the `node` user to the docker socket's group so `docker logs` /
# `docker ps` work from /api/logs/stream. The compose file already adds
# the right GID as a supplementary group on the process — but `su-exec`
# below doesn't propagate supplementary groups, so we instead bake the
# membership into /etc/group, which su-exec WILL pick up.
#
# GID is auto-detected from the mounted socket so we don't hardcode it
# (different hosts can have different `docker` group IDs).
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
  if [ -n "${DOCKER_GID}" ] && [ "${DOCKER_GID}" != "0" ]; then
    # Create the group if missing under any name.
    if ! getent group "${DOCKER_GID}" >/dev/null 2>&1; then
      addgroup -g "${DOCKER_GID}" docker-host >/dev/null 2>&1 || true
    fi
    GRP_NAME="$(getent group "${DOCKER_GID}" | cut -d: -f1)"
    if [ -n "${GRP_NAME}" ]; then
      addgroup node "${GRP_NAME}" >/dev/null 2>&1 || true
    fi
  fi
fi

# Drop privileges and exec the requested command.
exec su-exec node "$@"
