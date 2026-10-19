#!/usr/bin/env bash
# ==============================================================================
# HatDot Origin Server Ingress Rollback Script
#
# OBJECTIVE:
# Instantly restore the previous firewall state and re-open standard ports
# if an operator experiences connectivity issues or unexpected service disruption.
# ==============================================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be executed as root (e.g. sudo bash $0)." >&2
  exit 1
fi

BACKUP_DIR="/etc/dokploy/security"

echo "===================================================================="
echo "          HatDot Origin Firewall Emergency Rollback Runbook         "
echo "===================================================================="

# 1. Kill any running safety watchdog timers
if [ -f "${BACKUP_DIR}/watchdog.pid" ]; then
  WATCHDOG_PID=$(cat "${BACKUP_DIR}/watchdog.pid" || true)
  if [ -n "${WATCHDOG_PID}" ]; then
    kill "${WATCHDOG_PID}" 2>/dev/null || true
    echo "Terminated watchdog process (PID: ${WATCHDOG_PID})."
  fi
  rm -f "${BACKUP_DIR}/watchdog.pid"
fi

pkill -f "sleep.*&& ufw --force disable" || true

# 2. Disable UFW
if command -v ufw >/dev/null 2>&1; then
  echo "Disabling UFW..."
  ufw --force disable || true
fi

# 3. Restore iptables backups if present
if [ -f "${BACKUP_DIR}/iptables-pre-lockdown.rules" ] && command -v iptables-restore >/dev/null 2>&1; then
  echo "Restoring IPv4 iptables pre-lockdown backup..."
  iptables-restore < "${BACKUP_DIR}/iptables-pre-lockdown.rules" || true
fi

if [ -f "${BACKUP_DIR}/ip6tables-pre-lockdown.rules" ] && command -v ip6tables-restore >/dev/null 2>&1; then
  echo "Restoring IPv6 ip6tables pre-lockdown backup..."
  ip6tables-restore < "${BACKUP_DIR}/ip6tables-pre-lockdown.rules" || true
fi

echo "===================================================================="
echo "Rollback complete. Firewall restored to pre-lockdown state."
echo "===================================================================="
