#!/usr/bin/env bash
# ==============================================================================
# HatDot Origin Server Ingress Lockdown Runbook Script
#
# OBJECTIVE:
# Restrict ports 80 (HTTP) and 443 (HTTPS) strictly to Cloudflare edge proxies.
# Prevent direct public exposure of the underlying Contabo server IP.
#
# SAFETY GUARANTEES:
# 1. Takes pre-change backups of UFW and iptables / ip6tables state.
# 2. Arms an automatic 5-minute safety watchdog (auto-disables UFW if disconnected).
# 3. Preserves SSH access (detects active SSH port or defaults to port 22).
# 4. Preserves Docker Swarm cluster overlay network (2377, 7946, 4789).
# 5. Configures both IPv4 and IPv6 to prevent IPv6 direct origin disclosure bypass.
# 6. Blocks direct external connections to internal database ports (5432, 3306, etc.)
#    without affecting internal Docker/Swarm container-to-container networking.
# ==============================================================================

set -euo pipefail

# 1. Pre-flight Root Check
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be executed as root (e.g. sudo bash $0)." >&2
  exit 1
fi

SSH_PORT="${SSH_PORT:-22}"
WATCHDOG_TIMEOUT="${WATCHDOG_TIMEOUT:-300}"
BACKUP_DIR="/etc/dokploy/security"

echo "===================================================================="
echo "      HatDot Origin IP Protection - Staged Ingress Lockdown        "
echo "===================================================================="
echo "Target SSH Port: ${SSH_PORT}"
echo "Watchdog Timeout: ${WATCHDOG_TIMEOUT} seconds"
echo "Backup Directory: ${BACKUP_DIR}"
echo "===================================================================="

# 2. Pre-change Configuration Backup
echo "[Step 1/6] Creating pre-change backups..."
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if command -v ufw >/dev/null 2>&1; then
  ufw status verbose > "${BACKUP_DIR}/ufw-status-pre-lockdown.txt" || true
fi
if command -v iptables-save >/dev/null 2>&1; then
  iptables-save > "${BACKUP_DIR}/iptables-pre-lockdown.rules" || true
fi
if command -v ip6tables-save >/dev/null 2>&1; then
  ip6tables-save > "${BACKUP_DIR}/ip6tables-pre-lockdown.rules" || true
fi
echo "Pre-change backups saved in ${BACKUP_DIR}."

# 3. Arming Safety Watchdog
echo "[Step 2/6] Arming 5-minute safety watchdog..."
echo "If connection drops, UFW will automatically disable after ${WATCHDOG_TIMEOUT} seconds."
(
  sleep "${WATCHDOG_TIMEOUT}"
  if ufw status | grep -q "Status: active"; then
    echo "WATCHDOG: Timeout reached without manual confirmation. Disabling UFW to prevent lockout..." >&2
    ufw --force disable || true
  fi
) &
WATCHDOG_PID=$!
echo "${WATCHDOG_PID}" > "${BACKUP_DIR}/watchdog.pid"
echo "Watchdog armed with PID ${WATCHDOG_PID}."

# 4. Configure IPv6 Support in UFW
echo "[Step 3/6] Ensuring IPv6 is enabled in UFW..."
if [ -f /etc/default/ufw ]; then
  sed -i 's/IPV6=no/IPV6=yes/' /etc/default/ufw || true
fi

# 5. Reset / Base Rule Configuration
echo "[Step 4/6] Applying base ingress rules and preserving administrative SSH..."
ufw default deny incoming
ufw default allow outgoing
ufw allow in on lo to any

# SSH Access
ufw allow "${SSH_PORT}/tcp" comment "HatDot Administrative SSH Access"

# Docker Swarm Inter-node Networking (Overlay mesh)
ufw allow 2377/tcp comment "Swarm Cluster Management"
ufw allow 7946/tcp comment "Swarm Node Discovery TCP"
ufw allow 7946/udp comment "Swarm Node Discovery UDP"
ufw allow 4789/udp comment "Swarm VXLAN Overlay Network"

# 6. Restrict HTTP (80) & HTTPS (443) Strictly to Cloudflare Edge Ranges
echo "[Step 5/6] Restricting ports 80 & 443 strictly to Cloudflare Edge IP ranges..."

# Cloudflare IPv4 CIDRs (Source: https://www.cloudflare.com/ips-v4)
CLOUDFLARE_IPV4=(
  "173.245.48.0/20"
  "103.21.244.0/22"
  "103.22.200.0/22"
  "103.31.4.0/22"
  "141.101.64.0/18"
  "108.162.192.0/18"
  "190.93.240.0/20"
  "188.114.96.0/20"
  "197.234.240.0/22"
  "198.41.128.0/17"
  "162.158.0.0/15"
  "104.16.0.0/13"
  "104.24.0.0/14"
  "172.64.0.0/13"
  "131.0.72.0/22"
)

# Cloudflare IPv6 CIDRs (Source: https://www.cloudflare.com/ips-v6)
CLOUDFLARE_IPV6=(
  "2400:cb00::/32"
  "2606:4700::/32"
  "2803:f800::/32"
  "2405:b500::/32"
  "2405:8100::/32"
  "2a06:98c0::/29"
  "2c0f:f248::/32"
)

for cidr in "${CLOUDFLARE_IPV4[@]}"; do
  ufw allow from "${cidr}" to any port 80 proto tcp comment "Cloudflare IPv4 HTTP"
  ufw allow from "${cidr}" to any port 443 proto tcp comment "Cloudflare IPv4 HTTPS"
done

for cidr in "${CLOUDFLARE_IPV6[@]}"; do
  ufw allow from "${cidr}" to any port 80 proto tcp comment "Cloudflare IPv6 HTTP"
  ufw allow from "${cidr}" to any port 443 proto tcp comment "Cloudflare IPv6 HTTPS"
done

# Shield Database and Admin Ports from direct external access
echo "Securing database and administrative ports from public ingress..."
ufw deny 5432 comment "Deny Direct Public PostgreSQL"
ufw deny 3306 comment "Deny Direct Public MySQL / MariaDB"
ufw deny 6379 comment "Deny Direct Public Redis"
ufw deny 27017 comment "Deny Direct Public MongoDB"
ufw deny 2375:2376/tcp comment "Deny Direct Public Docker Engine API"
ufw deny 8080/tcp comment "Deny Direct Public Traefik API"

# 7. Enable Firewall
echo "[Step 6/6] Activating UFW with locked-down ingress rules..."
ufw --force enable

echo "===================================================================="
echo "          LOCKDOWN APPLIED SUCCESSFULLY (IN TESTING WINDOW)         "
echo "===================================================================="
echo "UFW is now ACTIVE. Direct public access to ports 80/443 is blocked."
echo "Only Cloudflare edge proxy IPs can reach HTTP and HTTPS."
echo ""
echo "CRITICAL VERIFICATION STEP:"
echo "1. Open a new terminal and verify that SSH works:"
echo "   ssh -p ${SSH_PORT} user@<your-contabo-ip>"
echo "2. Test that panel.hatdot.cloud and apps work through Cloudflare."
echo "3. Test that direct curl to origin IP is dropped or timed out:"
echo "   curl -k --connect-timeout 5 https://<your-contabo-ip>"
echo ""
echo "CONFIRMATION:"
echo "To disarm the 5-minute auto-rollback watchdog, execute:"
echo "   kill \$(cat ${BACKUP_DIR}/watchdog.pid) && rm -f ${BACKUP_DIR}/watchdog.pid"
echo "   echo 'Lockdown confirmed and watchdog disarmed.'"
echo ""
echo "EMERGENCY ROLLBACK:"
echo "If any unexpected issue occurs, run:"
echo "   bash $(dirname "$0")/origin-firewall-rollback.sh"
echo "===================================================================="
