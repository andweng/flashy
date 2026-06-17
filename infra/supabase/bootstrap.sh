#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 VM to run self-hosted Supabase for Flashy.
# Idempotent: safe to re-run; will not overwrite an existing .env.
#
# Usage (from the VM, as a sudo-capable user):
#   ./bootstrap.sh
#
# After it finishes, edit /opt/supabase/docker/.env, then `docker compose up -d`.
set -euo pipefail

REPO_DIR="/opt/supabase"
COMPOSE_DIR="$REPO_DIR/docker"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 1. Docker + Compose plugin ----------
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo ">> Docker installed. Log out and back in for group membership to apply."
fi

# ---------- 2. Clone Supabase (shallow) ----------
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo ">> Cloning Supabase to $REPO_DIR..."
  sudo mkdir -p "$REPO_DIR"
  sudo chown "$USER:$USER" "$REPO_DIR"
  git clone --depth 1 https://github.com/supabase/supabase "$REPO_DIR"
fi

# ---------- 3. Drop overlay files alongside Supabase's compose ----------
echo ">> Staging overlay files into $COMPOSE_DIR..."
cp "$HERE/docker-compose.override.yml" "$COMPOSE_DIR/docker-compose.override.yml"
cp "$HERE/Caddyfile" "$COMPOSE_DIR/Caddyfile"

# ---------- 4. Seed .env from example if missing ----------
if [[ ! -f "$COMPOSE_DIR/.env" ]]; then
  cp "$COMPOSE_DIR/.env.example" "$COMPOSE_DIR/.env"
  echo "DOMAIN=" >> "$COMPOSE_DIR/.env"
  echo ">> $COMPOSE_DIR/.env created — edit before bringing the stack up."
fi

cat <<EOF

==========================================================================
 Bootstrap complete. Next steps (manual, on this VM):

 1. Edit $COMPOSE_DIR/.env and set, at minimum:
      POSTGRES_PASSWORD=<strong random>
      JWT_SECRET=<32+ char random>
      ANON_KEY=<JWT signed with JWT_SECRET, role=anon>
      SERVICE_ROLE_KEY=<JWT signed with JWT_SECRET, role=service_role>
      DASHBOARD_USERNAME=<for Studio basic auth>
      DASHBOARD_PASSWORD=<strong random>
      DOMAIN=api.<your-domain>
      API_EXTERNAL_URL=https://api.<your-domain>
      SUPABASE_PUBLIC_URL=https://api.<your-domain>
      SITE_URL=https://<your-domain>   # e.g. where the Expo app is served

    Generate JWT keys with the snippet at:
      https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys

 2. Make sure:
      - DNS: A record for api.<your-domain> points at this VM's public IP
      - Router: forwards TCP 80 and 443 to this VM. Do NOT forward 3000 or 8000.

 3. Start the stack:
      cd $COMPOSE_DIR
      docker compose pull
      docker compose up -d

 4. Apply the Flashy schema:
      ./apply-migration.sh

 5. Access:
      - Studio (LAN only):  http://<vm-lan-ip>:3000
      - API (public):       https://api.<your-domain>/rest/v1/   (returns 401)

==========================================================================
EOF
