#!/bin/sh
# Mission Control container entrypoint.
#
# Runs as root, fixes the data dir ownership, then drops to uid 1000 (node)
# before exec'ing the Next.js server. This decouples us from the named
# volume's pre-existing ownership — useful when migrating between deploys
# (e.g. the original image used uid 1001, this one uses uid 1000).
set -e

# Ensure data dir exists and is writable by the runtime user.
mkdir -p /app/data
chown -R node:node /app/data

# Drop privileges and exec the requested command.
exec su-exec node "$@"
