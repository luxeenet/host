# HatDot: Origin IP Protection & Secure Public Ingress Architecture Guide

This document provides the authoritative engineering assessment, implementation details, Cloudflare configuration guide, staged origin lockdown runbook, verification procedures, and residual risk analysis for hiding Contabo origin server IPs across all HatDot hosted applications (`*.hatdot.cloud`, `panel.hatdot.cloud`, and customer custom domains).

---

## 1. Architectural Assessment

### 1.1 Current Ingress & Routing Topology
- **Host Provider**: Contabo Cloud VPS (Ubuntu Linux, systemd, Docker Swarm node).
- **Core Orchestrator**: Docker Swarm running single-manager mode.
- **Routing Engine**: Traefik v3 (`dokploy-traefik` service) attached to the `dokploy-network` overlay network.
- **Application Services**: Dokploy API/Dashboard (`dokploy` container on port 3000), customer containerized applications, compose stacks, and managed databases (`dokploy-postgres`, `dokploy-mariadb`, `dokploy-mysql`, `dokploy-mongo`, `dokploy-redis`).
- **Domain Scope**:
  - `hatdot.cloud` (Root domain / landing)
  - `*.hatdot.cloud` (Wildcard application routing)
  - `panel.hatdot.cloud` (HatDot management dashboard)
  - Customer custom domains (e.g., `clientapp.com`, `api.customer.io`)

### 1.2 Vulnerability & IP Disclosure Analysis
Before this implementation:
1. **Direct DNS Disclosure**: If DNS records for `hatdot.cloud`, `*.hatdot.cloud`, or `panel.hatdot.cloud` were DNS-only (`A` records pointing directly to the Contabo IP), any `dig`, `nslookup`, or browser request directly revealed the origin IP address.
2. **Missing Traefik Trusted IPs**: Traefik's `web` (80) and `websecure` (443) entryPoints had no `forwardedHeaders.trustedIPs` configured. Without this:
   - Traefik stripped or ignored `CF-Connecting-IP` / `X-Forwarded-For` from Cloudflare edge proxies.
   - All backend logs attributed client traffic to Cloudflare edge nodes rather than actual visitor IPs.
   - Applications that attempted to inspect raw forwarded headers without verified upstream checks were vulnerable to client IP spoofing.
3. **Open Origin Ports**: The origin server firewall was not restricted to Cloudflare proxies, meaning attackers who obtained the Contabo IP could bypass Cloudflare DDoS protection and WAF rules by querying `https://<CONTABO_IP>` directly with a `Host:` header.
4. **IPv6 Exposure Risk**: Contabo VPS nodes often come with auto-configured IPv6 `/64` subnets. Locking down only IPv4 iptables while leaving IPv6 open allows attackers to discover and bypass origin protections via IPv6 scanning.
5. **Direct Database Exposure**: Containerized databases could potentially be exposed if port bindings like `-p 5432:5432` were used without binding strictly to `127.0.0.1` or internal Docker overlay networks.

---

## 2. Implemented Architecture & Code Changes

### 2.1 Traefik Forwarded Headers Configuration
In `packages/server/src/setup/traefik-setup.ts`, Traefik's default entrypoints now configure `forwardedHeaders.trustedIPs`:
```yaml
entryPoints:
  web:
    address: ":80"
    forwardedHeaders:
      trustedIPs:
        # Cloudflare Published IPv4 CIDRs
        - 173.245.48.0/20
        - 103.21.244.0/22
        - 103.22.200.0/22
        - 103.31.4.0/22
        - 141.101.64.0/18
        - 108.162.192.0/18
        - 190.93.240.0/20
        - 188.114.96.0/20
        - 197.234.240.0/22
        - 198.41.128.0/17
        - 162.158.0.0/15
        - 104.16.0.0/13
        - 104.24.0.0/14
        - 172.64.0.0/13
        - 131.0.72.0/22
        # Cloudflare Published IPv6 CIDRs
        - 2400:cb00::/32
        - 2606:4700::/32
        - 2803:f800::/32
        - 2405:b500::/32
        - 2405:8100::/32
        - 2a06:98c0::/29
        - 2c0f:f248::/32
        # Local & Docker Swarm Overlay
        - 127.0.0.1/32
        - ::1/128
        - 10.0.0.0/8
        - 172.16.0.0/12
        - 192.168.0.0/16
  websecure:
    address: ":443"
    forwardedHeaders:
      trustedIPs: [...]
```

### 2.2 Canonical Cloudflare Ranges & Origin Protection Service
1. **`packages/server/src/constants/cloudflare-ips.ts`**:
   - Maintains verified, immutable lists of Cloudflare IPv4 & IPv6 CIDRs and local/private networks (`CLOUDFLARE_IPV4_CIDRS`, `CLOUDFLARE_IPV6_CIDRS`, `TRAEFIK_DEFAULT_TRUSTED_IPS`).
2. **`packages/server/src/services/origin-protection.ts`**:
   - `isCloudflareIp(ip)`: High-performance IPv4 (bitwise integer) and IPv6 (128-bit BigInt) subnet matching.
   - `isTrustedProxyIp(ip)`: Verifies whether an upstream peer IP is a recognized proxy or internal container.
   - `extractTrustedClientIp(headers, remoteAddress)`: Safely extracts `CF-Connecting-IP` only when the request arrives from a verified Cloudflare proxy; falls back cleanly without permitting header spoofing.
   - `assessDomainIngress(domain, resolvedIps, originIps)`: Categorizes domains into `PROXIED_CLOUDFLARE`, `DIRECT_ORIGIN_EXPOSED`, `THIRD_PARTY_UNPROXIED`, or `UNRESOLVED`.
   - `generateUfwLockdownScript(options)` and `generateRollbackScript()`: Programmatic generators for origin firewall management.
3. **`packages/server/src/services/cdn.ts`**:
   - Updated CDN detection to use `isCloudflareIp` for full IPv4 + IPv6 parity.

---

## 3. Cloudflare DNS & TLS Configuration Instructions

### 3.1 DNS Record Matrix
Configure the following in the Cloudflare DNS dashboard for `hatdot.cloud`:

| Type | Name | Content / Target | Proxy Status | Description |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `hatdot.cloud` | `<CONTABO_ORIGIN_IPV4>` | **Proxied (Orange Cloud)** | Root domain landing page |
| **AAAA** | `hatdot.cloud` | `<CONTABO_ORIGIN_IPV6>` | **Proxied (Orange Cloud)** | Optional IPv6 origin mapping |
| **A** | `panel` | `<CONTABO_ORIGIN_IPV4>` | **Proxied (Orange Cloud)** | `panel.hatdot.cloud` dashboard |
| **A** | `*` | `<CONTABO_ORIGIN_IPV4>` | **Proxied (Orange Cloud)** | Wildcard applications (`*.hatdot.cloud`) |
| **A** | `origin-direct` | `<CONTABO_ORIGIN_IPV4>` | **DNS-only (Grey Cloud)** | **DO NOT CREATE.** (Creating a direct origin A record completely voids origin IP hiding.) |
| **MX** | `hatdot.cloud` | `mail.external-provider.com` | **DNS-only (Grey Cloud)** | MX records cannot be proxied through Cloudflare HTTP proxy. Use third-party mail (Google Workspace, Fastmail, Postmark, Resend). Never point MX to Contabo IP! |
| **TXT** | `hatdot.cloud` | `v=spf1 include:... ~all` | **DNS-only** | Standard SPF records |

> [!IMPORTANT]
> **Records that MUST be Proxied (Orange Cloud)**:
> - `hatdot.cloud`
> - `panel.hatdot.cloud`
> - `*.hatdot.cloud`
>
> **Records that MUST remain DNS-only**:
> - MX, TXT, SRV, and any non-HTTP/HTTPS protocol records.

### 3.2 SSL/TLS Encryption Mode: Full (strict)
In the Cloudflare Dashboard under **SSL/TLS -> Overview**:
- Select **Full (strict)**.
- **Why NOT Flexible?**: Flexible SSL makes Cloudflare connect to the origin over HTTP port 80. Traefik's `redirect-to-https` middleware automatically redirects port 80 requests to port 443 with a 301. Cloudflare receives the 301, repeats the request over port 80, and enters an **infinite redirect loop** (`ERR_TOO_MANY_REDIRECTS`).
- **Why Strict?**: Full (strict) ensures end-to-end encryption between Cloudflare edge and Traefik origin, validating that the origin presents a valid certificate.

### 3.3 Origin Certificate Installation (Recommended)
While Traefik can continue using Let's Encrypt for public certificates, once origin firewall lockdown drops non-Cloudflare traffic on port 80, Let's Encrypt `httpChallenge` requests from Let's Encrypt ACME validation servers will be blocked (unless using DNS-01 ACME challenge).
The recommended production setup is a **Cloudflare Origin CA Certificate**:
1. In Cloudflare Dashboard -> **SSL/TLS -> Origin Server -> Create Certificate**.
2. Hostnames: `*.hatdot.cloud`, `hatdot.cloud`.
3. Validity: 15 years.
4. Save the Origin Certificate to `/etc/dokploy/traefik/dynamic/certs/hatdot.crt`.
5. Save the Private Key to `/etc/dokploy/traefik/dynamic/certs/hatdot.key`.
6. Add `/etc/dokploy/traefik/dynamic/certificates.yml`:
   ```yaml
   tls:
     certificates:
       - certFile: /etc/dokploy/traefik/dynamic/certs/hatdot.crt
         keyFile: /etc/dokploy/traefik/dynamic/certs/hatdot.key
     stores:
       default:
         defaultCertificate:
           certFile: /etc/dokploy/traefik/dynamic/certs/hatdot.crt
           keyFile: /etc/dokploy/traefik/dynamic/certs/hatdot.key
   ```
Traefik dynamically picks up this certificate without downtime.

### 3.4 Network & Protocol Settings in Cloudflare
- **WebSockets**: Enabled (under **Network -> WebSockets**). Required for Dokploy deployment logs, container terminal, and real-time dashboard events.
- **gRPC**: Enabled if any customer apps utilize gRPC streaming.
- **HTTP/2 & HTTP/3 (QUIC)**: Enabled.
- **Client IP Geolocation**: Enabled (Cloudflare injects `CF-IPCountry` header).
- **Maximum Upload Size**: Cloudflare Free supports up to 100 MB per request. For enterprise apps requiring up to 1 GB uploads (matching HatDot's `OPENAPI_MAX_UPLOAD_SIZE`), configure chunked uploads or Cloudflare Pro/Business tiers.

---

## 4. Staged, Reversible Origin-Lockdown Procedure

The lockdown procedure is automated via [`scripts/security/origin-firewall-lockdown.sh`](file:///c:/Users/hosting/dokploy/scripts/security/origin-firewall-lockdown.sh) and recoverable via [`scripts/security/origin-firewall-rollback.sh`](file:///c:/Users/hosting/dokploy/scripts/security/origin-firewall-rollback.sh).

### Pre-change Checklist:
- [ ] Confirm `hatdot.cloud`, `panel.hatdot.cloud`, and `*.hatdot.cloud` are proxied (Orange Cloud) in Cloudflare.
- [ ] Confirm Cloudflare SSL/TLS is set to **Full (strict)**.
- [ ] Ensure you have an active SSH session to the Contabo server, and note the port (default 22).
- [ ] Ensure Contabo Web Console (VNC emergency access) is reachable in the Contabo Customer Control Panel in case of network misconfiguration.

### Execution Steps:
1. SSH into the Contabo origin server as root:
   ```bash
   ssh root@<contabo-origin-ip>
   ```
2. Inspect the lockdown script:
   ```bash
   cat /path/to/dokploy/scripts/security/origin-firewall-lockdown.sh
   ```
3. Run the script:
   ```bash
   bash /path/to/dokploy/scripts/security/origin-firewall-lockdown.sh
   ```
4. **Safety Watchdog Notice**:
   - The script creates backups in `/etc/dokploy/security/`.
   - A background watchdog process starts with a 300-second (5-minute) timer.
   - If the operator does not confirm success within 5 minutes, UFW automatically disables itself.
5. **Immediate Ingress Verification**:
   - Open a **second terminal** and verify SSH remains responsive:
     ```bash
     ssh root@<contabo-origin-ip>
     ```
   - Test platform access via browser:
     - `https://panel.hatdot.cloud`
     - `https://hatdot.cloud`
   - Test that direct public access to origin IP is dropped:
     ```bash
     curl -k --connect-timeout 5 https://<contabo-origin-ip>
     # Expected: Connection timed out or connection refused
     ```
   - Test that direct access to database ports from public is blocked:
     ```bash
     nc -zv -w 3 <contabo-origin-ip> 5432
     # Expected: Connection timed out / closed
     ```
6. **Confirm Lockdown**:
   - If all checks pass, kill the safety watchdog timer:
     ```bash
     kill $(cat /etc/dokploy/security/watchdog.pid) && rm -f /etc/dokploy/security/watchdog.pid
     echo "Lockdown confirmed."
     ```
7. **Emergency Rollback**:
   - If anything fails, run:
     ```bash
     bash /path/to/dokploy/scripts/security/origin-firewall-rollback.sh
     ```

---

## 5. Customer Custom Domains

Customers deploying on HatDot can configure custom domains (e.g. `app.customer.com`).

### Scenario A: Customer Uses Cloudflare DNS
1. The customer creates a **CNAME** record in their Cloudflare dashboard:
   - Type: `CNAME`
   - Name: `app` (or `@`)
   - Target: `<customer-app-name>.hatdot.cloud`
   - Proxy status: **Proxied (Orange Cloud)**
2. In their Cloudflare SSL/TLS settings, the customer sets SSL mode to **Full** or **Full (strict)**.
3. In HatDot Dashboard -> Application -> Domains, they add `app.customer.com`.
4. **Security outcome**: The origin Contabo IP is **100% hidden**. Traffic flows Customer -> Customer's Cloudflare Edge -> HatDot Traefik -> Customer Container.

### Scenario B: Customer Uses Third-Party DNS (GoDaddy, Namecheap, Route 53, etc.)
If a customer uses a DNS provider without Cloudflare proxying:
- **Direct A record to Contabo IP**:
  - *Risk*: This exposes the Contabo server IP in public DNS lookups (`dig app.customer.com` -> `<CONTABO_IP>`).
  - *Failure with lockdown*: Once the origin firewall is locked down to Cloudflare IPs, direct browser requests to `app.customer.com` will be dropped by UFW!
- **Supported Architecture**:
  1. **Option 1 (Recommended)**: Customer onboards their DNS to Cloudflare (Free plan supported) and enables proxying.
  2. **Option 2 (Cloudflare for SaaS / Custom Hostnames)**:
     - HatDot configures Cloudflare for SaaS on the `hatdot.cloud` zone.
     - The customer points a `CNAME` record to `fallback.hatdot.cloud`.
     - Cloudflare edge terminates SSL and proxies traffic through Cloudflare's network to HatDot origin.
     - Origin IP remains completely hidden.

---

## 6. Remaining Origin-IP Disclosure Risks & Mitigations

Even with DNS proxying and firewall restrictions, certain application behaviors can inadvertently reveal an origin IP. Operators should enforce the following operational hygiene:

| Disclosure Vector | Risk Mechanism | Mitigation |
| :--- | :--- | :--- |
| **Outbound Email (SMTP)** | Applications sending email directly via postfix/sendmail on the Contabo server will include the server IP in `Received:` email headers. | **Enforce External Mail Relay**: Route all application emails through third-party transactional mail providers (Postmark, Resend, SendGrid, Amazon SES). Block outbound port 25 on host. |
| **Outbound Webhooks / SSRF** | If an application allows users to submit a URL for fetching (webhooks, avatar imports, PDF generation), the outgoing HTTP request leaves from the Contabo public IP. | Use an egress proxy (e.g. Squid / Smokescreen) for outbound user-controlled requests, or run egress traffic through a VPN / NAT gateway. |
| **Historical DNS Records** | Security scanners (SecurityTrails, Censys, Shodan, ViewDNS) keep archives of previous `A` records before Cloudflare was enabled. | After implementing Cloudflare proxying and locking down origin ports, verify that direct connections to the historical IP are dropped. If historical leaks are a major concern, request a new IP from Contabo. |
| **Subdomain Leaks** | Administrative or legacy subdomains (e.g., `ssh.hatdot.cloud`, `ftp.hatdot.cloud`, `direct.hatdot.cloud`) configured as DNS-only. | Audit all DNS records under `hatdot.cloud` and eliminate unnecessary subdomains. Access SSH via IP or private WireGuard tunnel. |
| **SSL Certificate Transparency** | Generating Let's Encrypt certificates directly with Let's Encrypt logs hostnames to public CT logs. If an origin IP serves the certificate on a direct TLS handshake, Censys/Shodan correlates it. | Once firewall lockdown is active, scanners cannot complete a TLS handshake directly on the origin IP. Cloudflare Origin CA certificates are not logged to public CT logs. |
| **Docker Userland Proxy Bypassing UFW** | By default on Linux, Docker's `iptables` rules can bypass standard UFW `INPUT` chains if container ports are published to `0.0.0.0`. | Dokploy uses Docker Swarm overlay routing (`dokploy-network`) where Traefik handles routing internally without exposing container ports to the public host. Traefik's published ports 80/443 are filtered by UFW / iptables rules. |

---

## 7. Deliverables Summary

1. **`packages/server/src/constants/cloudflare-ips.ts`**: Canonical definitions of Cloudflare IPv4 & IPv6 CIDRs and trusted Traefik ranges.
2. **`packages/server/src/services/origin-protection.ts`**: Complete service for CIDR verification, trusted forwarded-header extraction, ingress assessment, and firewall script generation.
3. **`packages/server/src/setup/traefik-setup.ts`**: Integrated `forwardedHeaders.trustedIPs` on Traefik entrypoints.
4. **`packages/server/src/services/cdn.ts`**: Enhanced with IPv6 Cloudflare support.
5. **`scripts/security/origin-firewall-lockdown.sh`**: Staged, safe origin-lockdown bash runbook with 5-minute safety watchdog.
6. **`scripts/security/origin-firewall-rollback.sh`**: Emergency rollback runbook.
7. **`apps/dokploy/__test__/security/origin-ip-protection.test.ts`**: Comprehensive test suite validating all functionality.
