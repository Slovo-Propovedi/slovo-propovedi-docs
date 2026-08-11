#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# slovo-propovedi-docs — VPS Deployment Script
# =============================================================================
# Runs ON the VPS as root. Triggered by the Forgejo release workflow via SSH.
# Replaces the former Ansible role `roles/custom/slovo-docs/`.
#
# Usage:   DEPLOY_TAG=v1.0.0 bash vps-deploy.sh
#
# Idempotent: safe to re-run. Handles both first deploy and updates.
# Prerequisites (created by slovo-propovedi-playbook):
#   - `slovo` system user exists
#   - Docker buildx builder `slovo-constrained` exists
#   - Traefik reverse proxy is running (slovo-traefik.service)
# =============================================================================

# --- Configuration (override via env) ---
DEPLOY_TAG="${DEPLOY_TAG:?ERROR: DEPLOY_TAG is required (e.g. v1.0.0)}"
DOCS_HOSTNAME="${DOCS_HOSTNAME:-docs.slovo-propovedi.ru}"
DOCS_REPO="${DOCS_REPO:-https://git.lightnode.ru/Slovo_Propovedi/slovo-propovedi-docs.git}"
BASE_PATH="${BASE_PATH:-/slovo/docs}"
SRC_PATH="${SRC_PATH:-/slovo/docs/container-src}"
BUILDER_NAME="${BUILDER_NAME:-slovo-constrained}"
BUILDX_MEMORY="${BUILDX_MEMORY:-1g}"
BUILDX_CPU_QUOTA="${BUILDX_CPU_QUOTA:-80000}"
IMAGE_NAME="${IMAGE_NAME:-slovo-docs:latest}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
CONTAINER_NETWORK="${CONTAINER_NETWORK:-slovo-docs}"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-traefik}"
MEMORY_LIMIT="${MEMORY_LIMIT:-64m}"
STOP_GRACE="${STOP_GRACE:-3}"
TRAEFIK_SERVICE="${TRAEFIK_SERVICE:-slovo-traefik.service}"

# --- Banner ---
echo "==============================================================="
echo "  slovo-propovedi-docs deployment"
echo "  Tag:      $DEPLOY_TAG"
echo "  Hostname: $DOCS_HOSTNAME"
echo "==============================================================="

# --- Ensure prerequisites ---
echo ">> Ensuring prerequisites..."

# Docker — must be pre-installed (can't auto-install from a deploy script)
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed or not in PATH."
  echo "       Install Docker Engine: https://docs.docker.com/engine/install/"
  exit 1
fi
echo "  Docker: OK"

# slovo user + group — create if missing (matches playbook slovo-base role)
if ! getent group slovo >/dev/null 2>&1; then
  echo "  slovo group: missing -> creating..."
  groupadd --system slovo
fi
if ! id -u slovo >/dev/null 2>&1; then
  echo "  slovo user: missing -> creating..."
  useradd --system --no-create-home --shell /sbin/nologin --home /slovo --gid slovo slovo
fi
SLOVO_UID=$(id -u slovo)
SLOVO_GID=$(id -g slovo)
echo "  slovo user: OK (uid=$SLOVO_UID, gid=$SLOVO_GID)"

# buildx builder — create if missing (matches playbook slovo-buildx role)
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  echo "  buildx builder '$BUILDER_NAME': missing -> creating..."
  docker buildx create \
    --name "$BUILDER_NAME" \
    --driver docker-container \
    --driver-opt memory="$BUILDX_MEMORY" \
    --driver-opt cpu-quota="$BUILDX_CPU_QUOTA" \
    --bootstrap
fi
echo "  buildx builder: OK ($BUILDER_NAME)"

# traefik Docker network — create if missing
if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
  echo "  traefik network: missing -> creating..."
  docker network create "$TRAEFIK_NETWORK"
fi
echo "  traefik network: OK ($TRAEFIK_NETWORK)"

# Traefik service — must be running (can't auto-provision from a deploy script)
if ! systemctl is-active --quiet "$TRAEFIK_SERVICE" 2>/dev/null; then
  echo "ERROR: $TRAEFIK_SERVICE is not running."
  echo "       Traefik is required for TLS termination and hostname routing."
  echo "       Set it up via the slovo-propovedi-playbook:"
  echo "         just setup-traefik"
  exit 1
fi
echo "  Traefik: OK ($TRAEFIK_SERVICE active)"

# --- 1. Create paths ---
echo ">> Ensuring paths exist..."
mkdir -p "$BASE_PATH" "$SRC_PATH"
chown slovo:slovo "$BASE_PATH" "$SRC_PATH"
chmod 0750 "$BASE_PATH" "$SRC_PATH"

# --- 2. Clone / fetch repository ---
git config --global --add safe.directory "$SRC_PATH" 2>/dev/null || true

if [ ! -d "$SRC_PATH/.git" ]; then
  echo ">> Cloning repository (first deploy)..."
  rm -rf "$SRC_PATH"
  mkdir -p "$SRC_PATH"
  git clone "$DOCS_REPO" "$SRC_PATH"
fi

echo ">> Fetching and checking out tag $DEPLOY_TAG..."
cd "$SRC_PATH"
git fetch --tags --force origin
git checkout --force "$DEPLOY_TAG"
chown -R slovo:slovo "$SRC_PATH"

# --- 3. Write Traefik labels ---
echo ">> Writing Traefik labels..."
{
  printf 'traefik.enable=true\n'
  printf 'traefik.docker.network=%s\n' "$TRAEFIK_NETWORK"
  printf 'traefik.http.services.slovo-docs.loadbalancer.server.port=%s\n' "$CONTAINER_PORT"
  printf 'traefik.http.routers.slovo-docs.rule=Host(`%s`)\n' "$DOCS_HOSTNAME"
  printf 'traefik.http.routers.slovo-docs.service=slovo-docs\n'
  printf 'traefik.http.routers.slovo-docs.entrypoints=web-secure\n'
  printf 'traefik.http.routers.slovo-docs.tls=true\n'
  printf 'traefik.http.routers.slovo-docs.tls.certResolver=default\n'
} > "$BASE_PATH/labels"
chown slovo:slovo "$BASE_PATH/labels"
chmod 0640 "$BASE_PATH/labels"

# --- 4. Create Docker network (if missing) ---
echo ">> Ensuring Docker network '$CONTAINER_NETWORK'..."
docker network inspect "$CONTAINER_NETWORK" >/dev/null 2>&1 \
  || docker network create "$CONTAINER_NETWORK"

# --- 5. Build Docker image ---
echo ">> Building Docker image (this may take a minute)..."
docker buildx build \
  --builder="$BUILDER_NAME" \
  --load \
  --tag="$IMAGE_NAME" \
  "$SRC_PATH"

# --- 6. Write systemd unit ---
echo ">> Writing systemd unit..."
cat > /etc/systemd/system/slovo-docs.service <<EOF
[Unit]
Description=slovo-docs
Requires=docker.service
After=docker.service
Requires=$TRAEFIK_SERVICE
After=$TRAEFIK_SERVICE
DefaultDependencies=no

[Service]
Type=simple
Environment="HOME=/root"
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker stop -t $STOP_GRACE slovo-docs 2>/dev/null || true'
ExecStartPre=-/usr/bin/env sh -c '/usr/bin/env docker rm slovo-docs 2>/dev/null || true'
ExecStartPre=/usr/bin/env docker create \\
    --rm \\
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
    $IMAGE_NAME
ExecStartPre=/usr/bin/env docker network connect $TRAEFIK_NETWORK slovo-docs
ExecStart=/usr/bin/env docker start --attach slovo-docs
ExecStop=-/usr/bin/env sh -c '/usr/bin/env docker stop -t $STOP_GRACE slovo-docs 2>/dev/null || true'
Restart=always
RestartSec=30
SyslogIdentifier=slovo-docs

[Install]
WantedBy=multi-user.target
EOF

# --- 7. Reload and restart ---
echo ">> Reloading systemd and restarting service..."
systemctl daemon-reload
systemctl restart slovo-docs.service

# --- 8. Verify ---
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

# --- 9. Cleanup ---
rm -f /tmp/vps-deploy.sh
echo ">> Done."
