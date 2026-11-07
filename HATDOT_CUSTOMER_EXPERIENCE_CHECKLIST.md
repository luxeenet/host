# HatDot Platform-Wide Customer Terminology, Application Logs & Secure Application Terminal Checklist

## Phase 1: Codebase Audit & Discovery
- [x] Audit all customer-facing logs components (`ShowDockerLogs`, container selection, log viewer).
- [x] Audit terminal implementation (`apps/dokploy/server/wss/terminal.ts`, `docker-container-terminal.ts`, frontend terminal components).
- [x] Audit monitoring components (`ContainerFreeMonitoring`, `ContainerPaidMonitoring`, labels, metrics).
- [x] Audit deployment details, history, tooltips, dialogs, and empty states referencing "Container", "Docker", "Container ID".
- [x] Identify how Docker container IDs, internal swarm service names, and internal IPs leak into API responses and frontend views.

## Phase 2: Platform-Wide Terminology Normalization
- [x] "Container" -> "Application" (or "Instance" where replicas exist).
- [x] "Containers" -> "Applications".
- [x] "Select Container" -> "Select Application / Instance".
- [x] "Container Logs" -> "Application Logs".
- [x] "Container Terminal" / "Docker Terminal" -> "Application Terminal".
- [x] "Container ID" -> completely hidden/suppressed in customer views.
- [x] "Container Status" -> "Application Status".
- [x] "Container IP" -> hidden from customer view.
- [x] "Container Name" -> "Application Name".
- [x] Preserve technical Docker terminology exclusively for Platform Administrators.

## Phase 3: Application Selection & Multi-Instance Identity
- [x] Replace container ID dropdowns in logs and monitoring with friendly application / instance labels (`Instance 1`, `Instance 2`).
- [x] Redact container hashes (e.g., `849c7fd350dc`) and swarm service task IDs from customer dropdowns.
- [x] Verify tenant authorization on all application instance queries.

## Phase 4: Application Logs Redesign & Safe Diagnostics
- [x] Update Logs interface to display Application Name, Deployment context, timestamps, runtime & build logs.
- [x] Implement presentation-level redaction of container hashes, internal IPs, and host socket paths.
- [x] Add smart warning/error classification (e.g., recognizing `spawn xdg-open ENOENT` as a benign headless environment note, not deployment failure).
- [x] Support live log streaming, search, filtering, and clear empty states.

## Phase 5: Secure Application Terminal Architecture
- [x] Transform terminal into "Application Terminal" connected strictly into the application container.
- [x] Block host root access and host SSH shell access for customer accounts.
- [x] Enforce container security pre-flight checks:
  - [x] Reject if Docker socket (`/var/run/docker.sock`) is mounted.
  - [x] Reject if running in privileged mode.
  - [x] Reject if sensitive host directories are exposed.
- [x] Execute under non-root / application user where supported (e.g., `node`, `app`, `www-data`, non-root user).
- [x] Enforce strict tenant ownership on terminal session initiation.
- [x] Enforce session timeouts, concurrency limits, and record audit log entries on connect/disconnect.

## Phase 6: Terminal Subscription Entitlements
- [x] Add terminal entitlement check in `PlanEntitlementService`.
- [x] Server-side enforcement of terminal access permissions by plan.
- [x] Enforce collaborator role checks for terminal access.

## Phase 7: Customer API & Data Security Audit
- [x] Sanitize API outputs for non-admin customers: mask or omit raw container IDs, internal docker networks, host paths.
- [x] Ensure Platform Administrators retain access to raw infrastructure diagnostics.

## Phase 8: Automated Testing & Verification
- [x] Create Vitest test suite (`apps/dokploy/__test__/terminal/application-terminal-and-terminology.test.ts`):
  - [x] Terminology and container ID suppression tests.
  - [x] Friendly instance naming tests.
  - [x] Terminal preflight security validation (docker.sock mount rejection, privileged container rejection).
  - [x] Tenant isolation and cross-tenant terminal access rejection.
  - [x] Terminal subscription entitlement enforcement.
  - [x] Admin vs Customer visibility tests.
- [x] Run full workspace typecheck (`pnpm typecheck` in apps/dokploy and packages/server).
- [x] Verify existing application deployments, logs, and monitoring functionality.
- [x] Commit and push to `origin/hosting-platform`.
