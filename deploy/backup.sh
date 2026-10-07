#!/bin/sh
set -eu
TASK_BASE=/var/www/u3675365/data
TASK_DATA="$TASK_BASE/rewear-data"
TASK_BACKUPS="$TASK_BASE/rewear-backups"
umask 077
mkdir -p "$TASK_BACKUPS"
TASK_NAME="rewear-$(date -u +%Y%m%d-%H%M%S).tar.gz"
# Back up catalog and photos under the same application lock.
flock "$TASK_DATA/private/catalog.lock" tar -czf "$TASK_BACKUPS/$TASK_NAME.tmp" -C "$TASK_BASE" rewear-data
mv "$TASK_BACKUPS/$TASK_NAME.tmp" "$TASK_BACKUPS/$TASK_NAME"
