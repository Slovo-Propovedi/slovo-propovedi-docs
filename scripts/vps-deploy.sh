#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# VPS Deployment Script
# =============================================================================
# Runs ON the VPS as root. Triggered by the Forgejo release workflow via SSH.
# Replaces the former Ansible role `roles/custom/slovo-docs/`.
#
# Usage:   DEPLOY_TAG=v1.0.0 IMAGE_REF=git.lightnode.ru/slovo_propovedi/slovo-propovedi-docs \
#          DOCS_HOSTNAME=docs.example.com bash vps-deploy.sh
#
# The release workflow builds the image (with the BACKEND_API_HOSTNAME build
# arg baked in) using the shared `slovo-constrained` buildx builder ON this
# host and pushes it to the Forgejo container registry; this script only pulls
# the published tag. No source tree is shipped to the VPS. The registry is
# public (public org), so the pull is anonymous.
#
# Scope: this script owns ONLY the slovo-docs container and its own `slovo-docs`
# Docker network. All shared infrastructure — Docker, the `slovo` user/group,
# the buildx builder `slovo-constrained`, Traefik (`slovo-traefik.service`) and
# the `traefik` Docker network — is owned by the slovo-propovedi playbook.
# Missing infrastructure is a HARD ERROR here; it is never auto-provisioned.
# Run the playbook first:  just setup-all  (or: just setup-service <name>).
#
# Idempotent: safe to re-run. Handles both the first docs deploy and updates.
# =============================================================================

# --- Configuration (override via env) ---
DEPLOY_TAG="${DEPLOY_TAG:?ERROR: DEPLOY_TAG is required (e.g. v1.0.0)}"
DOCS_HOSTNAME="${DOCS_HOSTNAME:?ERROR: DOCS_HOSTNAME is required (e.g. docs.example.com)}"
BASE_PATH="${BASE_PATH:-/slovo/docs}"
# Full registry image ref (no tag) — passed by the release workflow. Required,
# no default: a renamed registry/org must fail loudly instead of pulling or
# creating a container from a stale local image.
IMAGE_REF="${IMAGE_REF:?ERROR: IMAGE_REF is required (full registry image ref, passed by the release workflow)}"
IMAGE="$IMAGE_REF:$DEPLOY_TAG"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
CONTAINER_NETWORK="${CONTAINER_NETWORK:-slovo-docs}"
MEMORY_LIMIT="${MEMORY_LIMIT:-64m}"
STOP_GRACE="${STOP_GRACE:-3}"

# Shared infrastructure names — owned by the slovo-propovedi playbook, passed
# by the release workflow from Forgejo org variables. No defaults: a renamed
# network/service/builder must fail loudly instead of using a stale name.
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:?ERROR: TRAEFIK_NETWORK is required (Forgejo org variable)}"
TRAEFIK_SERVICE="${TRAEFIK_SERVICE:?ERROR: TRAEFIK_SERVICE is required (Forgejo org variable)}"
BUILDER_NAME="${BUILDX_BUILDER:?ERROR: BUILDX_BUILDER is required (Forgejo org variable)}"

# Shared infrastructure this deploy depends on but does NOT own (playbook-managed).
REQUIRED_SERVICES="$TRAEFIK_SERVICE"
REQUIRED_NETWORKS="$TRAEFIK_NETWORK"

# --- Banner ---
echo "==============================================================="
echo "  VPS deployment"
echo "  Tag:      $DEPLOY_TAG"
echo "  Hostname: $DOCS_HOSTNAME"
echo "==============================================================="

# --- Verify prerequisites (playbook-owned; never auto-provisioned) ---
# This script owns ONLY the slovo-docs container and the slovo-docs network
# (created in step 3). Everything checked below is provisioned by the
# slovo-propovedi playbook (`just setup-all`). Anything missing fails fast with
# a clear message instead of a half-provisioned box or a crash-looping service.
echo ">> Verifying prerequisites..."

fail_missing() {
  echo "ERROR: $1" >&2
  echo "       Shared infrastructure is owned by the slovo-propovedi playbook." >&2
  echo "       Provision it first:  just setup-all   (or: just setup-service <name>)" >&2
  exit 1
}

# Docker
command -v docker >/dev/null 2>&1 || fail_missing "Docker is not installed."
systemctl is-active --quiet docker || fail_missing "Docker service is not running."
echo "  Docker: OK"

# slovo user + group (playbook slovo-base role).
# uid/gid are system-assigned, so capture them dynamically like the playbook does.
getent group slovo >/dev/null 2>&1 || fail_missing "Group 'slovo' does not exist (playbook slovo-base role)."
id -u slovo >/dev/null 2>&1 || fail_missing "User 'slovo' does not exist (playbook slovo-base role)."
SLOVO_UID=$(id -u slovo)
SLOVO_GID=$(id -g slovo)
echo "  slovo user: OK (uid=$SLOVO_UID, gid=$SLOVO_GID)"

# buildx builder (playbook slovo-buildx role). The CI release build runs
# through it on this host; the post-deploy cleanup caps its cache.
docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1 \
  || fail_missing "buildx builder '$BUILDER_NAME' does not exist (playbook slovo-buildx role)."
echo "  buildx builder: OK ($BUILDER_NAME)"

# Traefik fronts this service. If it runs under a different unit name, set
# TRAEFIK_SERVICE=<name>.
# shellcheck disable=SC2086 # word splitting of the space-separated list is intended
for svc in $REQUIRED_SERVICES; do
  systemctl is-active --quiet "$svc" 2>/dev/null \
    || fail_missing "Required service '$svc' is not running."
done
echo "  services: OK ($REQUIRED_SERVICES)"

# Shared Docker networks the container attaches to at runtime (the unit's
# ExecStartPre connects them in step 5). The
# slovo-docs network itself is this script's own and is created in step 3.
# shellcheck disable=SC2086 # word splitting of the space-separated list is intended
for net in $REQUIRED_NETWORKS; do
  docker network inspect "$net" >/dev/null 2>&1 \
    || fail_missing "Required Docker network '$net' does not exist."
done
echo "  networks: OK ($REQUIRED_NETWORKS)"

# --- 1. Create paths ---
echo ">> Ensuring paths exist..."
mkdir -p "$BASE_PATH"
chown slovo:slovo "$BASE_PATH"
chmod 0750 "$BASE_PATH"

# --- 2. Write Traefik labels ---
echo ">> Writing Traefik labels..."
{
  printf 'traefik.enable=true\n'
  printf 'traefik.docker.network=%s\n' "$TRAEFIK_NETWORK"
  printf 'traefik.http.services.slovo-docs.loadbalancer.server.port=%s\n' "$CONTAINER_PORT"
  # shellcheck disable=SC2016 # literal backticks are Traefik label syntax
  printf 'traefik.http.routers.slovo-docs.rule=Host(`%s`)\n' "$DOCS_HOSTNAME"
  printf 'traefik.http.routers.slovo-docs.service=slovo-docs\n'
  printf 'traefik.http.routers.slovo-docs.entrypoints=web-secure\n'
  printf 'traefik.http.routers.slovo-docs.tls=true\n'
  printf 'traefik.http.routers.slovo-docs.tls.certResolver=default\n'
} > "$BASE_PATH/labels"
chown slovo:slovo "$BASE_PATH/labels"
chmod 0640 "$BASE_PATH/labels"

# --- 3. Create Docker network (if missing) ---
echo ">> Ensuring Docker network '$CONTAINER_NETWORK'..."
docker network inspect "$CONTAINER_NETWORK" >/dev/null 2>&1 \
  || docker network create "$CONTAINER_NETWORK"

# --- 4. Pull the release image from the registry ---
# The image was built and pushed by the release workflow through the shared
# `slovo-constrained` builder. The org is public, so the pull is anonymous —
# no registry credentials are stored on the VPS. The version tag stays in the
# registry, keeping old releases redeployable for rollback.
echo ">> Pulling image $IMAGE..."
docker pull "$IMAGE"

# --- 5. Write systemd unit ---
echo ">> Writing systemd unit..."
cat > /etc/systemd/system/slovo-docs.service <<EOF
[Unit]
Description=slovo-docs
Requires=docker.service
After=docker.service
Wants=$TRAEFIK_SERVICE
After=$TRAEFIK_SERVICE
DefaultDependencies=no

[Service]
Type=simple
Environment="HOME=/root"
ExecStartPre=-/usr/bin/env docker rm -f slovo-docs
ExecStartPre=/usr/bin/env docker create \\
    --name=slovo-docs \\
    --log-driver=none \\
    --user=$SLOVO_UID:$SLOVO_GID \\
    --cap-drop=ALL \\
    --read-only \\
    --tmpfs /tmp:rw,noexec,nosuid,size=16m,uid=$SLOVO_UID,gid=$SLOVO_GID,mode=1777 \\
    --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=16m,uid=$SLOVO_UID,gid=$SLOVO_GID,mode=0700 \\
    --tmpfs /run:rw,noexec,nosuid,size=8m,uid=$SLOVO_UID,gid=$SLOVO_GID,mode=0755 \\
    --network=$CONTAINER_NETWORK \\
    --label-file=$BASE_PATH/labels \\
    --memory=$MEMORY_LIMIT \\
    $IMAGE
ExecStartPre=/usr/bin/env docker network connect $TRAEFIK_NETWORK slovo-docs
ExecStart=/usr/bin/env docker start --attach slovo-docs
ExecStop=-/usr/bin/env docker stop -t $STOP_GRACE slovo-docs
Restart=always
RestartSec=30
SyslogIdentifier=slovo-docs

[Install]
WantedBy=multi-user.target
EOF

# --- 6. Reload and restart ---
echo ">> Reloading systemd and restarting service..."
systemctl daemon-reload
systemctl restart slovo-docs.service

# --- 7. Verify ---
sleep 2
if systemctl is-active --quiet slovo-docs.service; then
  echo "[OK] slovo-docs.service is running"
  echo "[OK] Deployment of $DEPLOY_TAG complete"
  echo "     Site: https://$DOCS_HOSTNAME"
else
  echo "ERROR: slovo-docs.service failed to start"
  systemctl status slovo-docs.service --no-pager -l || true
  exit 1
fi

# --- 8. Post-deploy cleanup (non-fatal, best effort) ---
# Runs only after step 7 confirms the new service is active. Bounds disk growth
# on the 4 GB VPS across repeated releases: prunes dangling images only (no
# --all; old release tags stay on disk and in the registry on purpose — they
# are the rollback path) and caps the buildx builder cache shared with the CI
# release builds. Strictly non-fatal — with `set -e` a cleanup failure must
# never fail a successful deployment, so errors are logged as warnings.
echo ">> Pruning dangling Docker images..."
if ! docker image prune --force; then
  echo "WARN: docker image prune failed — skipping dangling image cleanup" >&2
fi

echo ">> Pruning buildx builder cache ($BUILDER_NAME, keep 2GB)..."
if ! docker buildx prune --builder "$BUILDER_NAME" --keep-storage 2GB --force; then
  echo "WARN: docker buildx prune failed — skipping builder cache cleanup" >&2
fi

# --- 9. Cleanup ---
rm -f /tmp/vps-deploy.sh
echo ">> Done."
