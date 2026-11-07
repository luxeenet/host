# HatDot Infrastructure Abstraction & Customer-Facing Hosting Experience Checklist

## Phase 1: Audit of Exposed Infrastructure Details
- [x] Identify all Cloudflare references in customer-facing pages, components, modals, and tables.
- [x] Identify port fields and manual port inputs exposed to customers in domain and application settings.
- [x] Identify API endpoints and error messages leaking internal infrastructure provider details.

## Phase 2: Cloudflare Abstraction & HatDot-Branded Customer Experience
- [x] Remove Cloudflare branding and replace with HatDot Managed Hosting experience:
  - [x] `apps/dokploy/pages/dashboard/domains.tsx`:
    - [x] Replace "Cloudflare Edge SSL", "Cloudflare for SaaS", "Cloudflare Proxy Setting" with HatDot Edge SSL & Managed Routing.
    - [x] Update toasts, stage badges, and modals to use HatDot terminology.
    - [x] Preserve admin-only configuration panel for authorized platform administrators.
  - [x] `apps/dokploy/components/dashboard/application/domains/dns-helper-modal.tsx`:
    - [x] Replace Cloudflare references with HatDot edge verification and routing instructions.
    - [x] Normalize lifecycle steps to HatDot's 4-step domain connection flow.
  - [x] `apps/dokploy/components/dashboard/application/domains/handle-domain.tsx`:
    - [x] Replace Cloudflare labels with HatDot Edge SSL.
    - [x] Update registrar instructions to generic registrar guidance (e.g. your domain registrar).
  - [x] `apps/dokploy/components/dashboard/application/domains/columns.tsx`:
    - [x] Update "Cloudflare Edge" badge to "HatDot Edge SSL".
  - [x] `apps/dokploy/components/dashboard/application/domains/show-domains.tsx`:
    - [x] Update "Cloudflare Edge" badge and tooltip to "HatDot Edge SSL & Managed Routing".

## Phase 3: Customer-Facing Port Abstraction & Intelligent Port Resolution
- [x] In `apps/dokploy/components/dashboard/application/domains/handle-domain.tsx`:
  - [x] Hide internal port field by default behind an "Advanced Settings" collapsible.
  - [x] Pre-populate port with detected application port (`suggestedPort` or resolved port).
  - [x] Add customer-friendly explanation that HatDot automatically detects and routes to the correct application port.
- [x] In `apps/dokploy/server/api/routers/domain.ts`:
  - [x] Automatically resolve application's detected port if port is not provided or defaulted.

## Phase 4: Normalized Domain & SSL Statuses
- [x] Standardize customer domain and SSL statuses across API and UI:
  - [x] Pending verification
  - [x] Verifying DNS
  - [x] DNS configuration required
  - [x] Domain connected
  - [x] SSL provisioning
  - [x] Secure and active
  - [x] Configuration issue
- [x] Ensure SSL is never reported as active until domain is verified and serving valid HTTPS.

## Phase 5: Backend & Customer API Separation
- [x] In `apps/dokploy/server/api/routers/domain.ts`:
  - [x] Provide backward-compatible aliases for `recheckCloudflareStatus` / `retryCloudflareProvisioning` while normalizing payloads (`recheckStatus` / `retrySsl`).
  - [x] Sanitize raw provider error messages (e.g. Cloudflare API error codes/tokens) into customer-friendly troubleshooting messages for non-admins.
  - [x] Restrict raw provider diagnostics and credentials strictly to platform administrators.

## Phase 6: Automated Testing & Verification
- [x] Create Vitest test suite (`apps/dokploy/__test__/domains/infrastructure-abstraction.test.ts`):
  - [x] Verify customer domain responses contain no Cloudflare branding or provider credentials.
  - [x] Verify automatic port detection and default port assignment.
  - [x] Verify advanced port configuration is preserved.
  - [x] Verify normalized domain and SSL lifecycle states.
  - [x] Verify error message sanitization.
  - [x] Verify admin vs customer visibility segregation.
- [x] Run full monorepo typecheck and test verification (all passed).
