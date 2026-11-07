# HatDot Customer Dashboard Simplification & Infrastructure Control Separation Checklist

## Phase 1: Audit & Discovery
- [x] Audit application dashboard tabs and components in `apps/dokploy/pages/dashboard/project/.../application/[applicationId].tsx`.
- [x] Identify raw Traefik exposure in frontend (`ShowTraefikConfig`, `UpdateTraefikConfig`) and backend (`readTraefikConfig`, `updateTraefikConfig`).
- [x] Audit Run Command functionality (`AddCommand`) and identify container command isolation requirements.
- [x] Audit Resources tab (`ShowResources`), entitlement checks, and redeployment notices.
- [x] Audit Redirects (`ShowRedirects`, `HandleRedirect`, `redirectsRouter`) and loop prevention.
- [x] Audit Security / Basic Auth (`ShowSecurity`, `HandleSecurity`, `securityRouter`) and credential masking.
- [x] Audit Port exposure (`ShowPorts`, `HandlePorts`, `handle-domain.tsx`).

## Phase 2: Traefik Removal from Customer View & Backend Enforcement
- [x] Remove `ShowTraefikConfig` from customer application settings.
- [x] In `apps/dokploy/server/api/routers/application.ts`:
  - [x] Enforce platform administrator authorization on `readTraefikConfig` (`platformAdminProcedure`).
  - [x] Enforce platform administrator authorization on `updateTraefikConfig` (`platformAdminProcedure`).
  - [x] Ensure non-admin customer requests are rejected with 403 Forbidden.
- [x] Preserve Traefik server-level management in platform admin settings (`settingsRouter.readTraefikConfig` / `updateTraefikConfig`).

## Phase 3: Run Command & Container Isolation in Advanced Developer Settings
- [x] Move startup Run Command & Arguments into "Advanced Developer Settings".
- [x] Implement secure container command execution endpoint (`api.application.runContainerCommand`):
  - [x] Enforce service permission and organization tenant isolation.
  - [x] Execute commands strictly inside the application's container (`docker exec` with escaped shell arguments).
  - [x] Apply execution timeout (30s limit with `Promise.race`).
  - [x] Enforce output size limit (max 100KB) with truncation notification to prevent DoS.
  - [x] Record audit log entries with user ID, application ID, command preview, exit code, and execution time.
  - [x] Prevent host system command injection and cross-tenant execution.
- [x] Provide developer UI in Advanced Developer Settings (`RunContainerCommand` component with terminal output, presets, badges, and status indicators).

## Phase 4: Resources Management & Subscription Enforcement
- [x] Elevate Resources to a dedicated primary tab: **Resources**.
- [x] Display clean CPU and RAM controls with user-friendly units (MB/GB and CPU cores).
- [x] Display subscription plan entitlement and allocation limits.
- [x] Enforce plan limits on backend mutations to prevent API bypass.
- [x] Add clear redeployment requirement notice: *"Resource changes are saved to the configuration. Click Redeploy to apply updated CPU and Memory limits to your running service."*

## Phase 5: Redirects Management & Loop Prevention
- [x] Elevate Redirects to a dedicated primary tab: **Redirects**.
- [x] In `apps/dokploy/server/api/routers/redirects.ts`:
  - [x] Validate regex syntax to ensure validity.
  - [x] Detect and reject circular redirects / infinite loop configurations (self-loops, self-matching replacement targets without variable capture, and multi-rule circular loops).
- [x] Provide clean interface for creating, editing, and deleting redirect rules without raw Traefik syntax.

## Phase 6: Security & Basic Authentication
- [x] Elevate Security to a dedicated primary tab: **Security**.
- [x] Ensure Basic Authentication credentials are never exposed in plaintext in API responses (`api.security.one`, `api.application.one`).
- [x] Mask credentials in API outputs (`password: "••••••••"`).
- [x] Ensure audit logs never store plaintext credentials.
- [x] Verify authentication rules apply strictly to the intended application.
- [x] Protect existing passwords from being overwritten when masked bullets are submitted during updates.

## Phase 7: Ports Abstraction
- [x] Remove raw Ports from customer default view; house in **Advanced Developer Settings**.
- [x] Add customer-friendly explanation that HatDot's Intelligent Deployment Engine automatically detects and routes application ports.
- [x] Preserve internal port configuration and manual override capability for advanced use cases.

## Phase 8: Final Customer Settings Structure & Tab Organization
- [x] Update `[applicationId].tsx` with the standardized customer navigation:
  - [x] General
  - [x] Domains & HTTPS
  - [x] Resources
  - [x] Redirects
  - [x] Security
  - [x] Preview Deployments
  - [x] Storage & Backups
  - [x] Advanced Developer Settings (Run Container Command, Startup Command, Port Overrides, and admin controls)
  - [x] (Operational tabs: Deployments, Logs, Monitoring, Environment, Schedules)
- [x] Remove Traefik from customer navigation completely.

## Phase 9: Automated Testing, Verification & Push
- [x] Create automated Vitest test suite (`apps/dokploy/__test__/application/customer-dashboard-isolation.test.ts`):
  - [x] Test Traefik API backend admin authorization restriction (non-admin receives 403 Forbidden).
  - [x] Test container command execution authorization, timeout, and output truncation.
  - [x] Test redirect loop prevention (syntax errors, identical patterns, self-matching patterns, circular rules).
  - [x] Test security credential masking in API responses (`security.one` and `application.one`).
  - [x] Test resource limit entitlement checks.
- [x] Run full monorepo typecheck and test verification (14/14 tests passing, zero TypeScript errors).
- [x] Commit and push to `origin/hosting-platform`.
