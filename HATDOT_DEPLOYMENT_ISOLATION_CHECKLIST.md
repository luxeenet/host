# HatDot Independent Customer Deployment & Multi-Tenant Execution Isolation Checklist

## Phase 1: Deployment Execution Architecture Audit
- [x] Audit deployment queue implementation (`apps/dokploy/server/queues/in-memory-queue.ts`)
  - Root cause 1: All local server jobs share a single `LOCAL_PARTITION = "__local__"`, mixing all tenants into a single waiting array.
  - Root cause 2: `drainPartition` picks the first job without tenant fairness, causing tenant starvation if one customer queues multiple builds.
  - Root cause 3: Concurrency default in `concurrency.ts` is `1` if unconfigured, artificially serializing all builds across all tenants.
  - Root cause 4: Per-tenant concurrency limits do not exist; a single customer can consume 100% of the platform build slots.
- [x] Audit cancellation safety (`apps/dokploy/server/queues/queueSetup.ts`)
  - Root cause 5: `killDockerBuild` executes `pkill -2 -f "docker build"` and `pkill -2 -f "docker compose"` indiscriminately killing all active builds across all tenants.
- [x] Audit tenant metadata and data leakage (`apps/dokploy/server/queues/queue-types.ts`, `apps/dokploy/server/api/routers/deployment.ts`)
  - Root cause 6: `DeploymentJob` lacks `organizationId` and `projectId`.
  - Root cause 7: `deployment.queueList` queries `myQueue.getJobs()` and exposes all queue jobs platform-wide without filtering by active organization/tenant.

## Phase 2: Queue Types & Tenant Context Injection
- [x] Update `DeploymentJob` type in `apps/dokploy/server/queues/queue-types.ts` to include `organizationId`, `projectId`, and `deploymentId`.
- [x] Inject tenant and project metadata into `myQueue.add` calls:
  - [x] `apps/dokploy/server/api/routers/application.ts` (`createQuickstart`, `redeploy`, `deploy`, `saveDropBuildPath`)
  - [x] `apps/dokploy/server/api/routers/compose.ts` (`deploy`, `redeploy`)
  - [x] `apps/dokploy/pages/api/deploy/github.ts` (push webhook, tag webhook, and preview deployment triggers)
  - [x] `apps/dokploy/pages/api/deploy/[refreshToken].ts` (deploy webhook token)
  - [x] `apps/dokploy/pages/api/deploy/compose/[refreshToken].ts` (compose deploy webhook token)
  - [x] `apps/dokploy/server/api/routers/domain.ts` (primary domain update / domain replacement redeployments)
  - [x] `apps/dokploy/server/api/routers/preview-deployment.ts` (preview redeployment)

## Phase 3: Fair Multi-Tenant Queue Engine & Project-Scoped Locks
- [x] Upgrade `apps/dokploy/server/queues/in-memory-queue.ts`:
  - [x] Implement per-tenant active tracking (`activePerTenant: Map<string, number>`).
  - [x] Implement configurable `tenantConcurrency` (`resolveTenantConcurrency`, `maxConcurrentPerTenant`, default 2 per tenant or half platform pool).
  - [x] Implement fair scheduling algorithm across waiting jobs (least active tenant load first, FIFO arrival order tiebreaker, complete starvation prevention).
  - [x] Maintain service-level FIFO serialization (`activeGroups: Set<string>` on `application:${appId}` / `compose:${composeId}`) to prevent filesystem/container collisions, while different services from the same or different tenants run in parallel.
  - [x] Add drain loop re-entrancy protection (`partition.draining` and `partition.needsDrain`) ensuring clean asynchronous scheduler lock step.
  - [x] Set sensible platform global build concurrency default in `concurrency.ts` (minimum 4 concurrent builds, dynamic based on CPU cores or `HATDOT_MAX_CONCURRENT_BUILDS`).
  - [x] Safe host resource & tenant entitlement validation via `PlanEntitlementService.assertRuntimeResources`.

## Phase 4: Targeted Build Cancellation & Isolation
- [x] Refactor `killDockerBuild` in `apps/dokploy/server/queues/queueSetup.ts`:
  - [x] Accept `appName` / service identifier.
  - [x] Cancel only the build process / containers matching that specific `appName` (`pkill -15 -f "${safeAppName}" || pkill -2 -f "${safeAppName}"`).
  - [x] Safely abort if `appName` is missing to prevent any blanket `pkill -2 -f "docker build"` from executing.
- [x] Update callers in `apps/dokploy/server/api/routers/application.ts` and `apps/dokploy/server/api/routers/compose.ts` to pass `application.appName` / `compose.appName`.

## Phase 5: Multi-Tenant Queue Visibility & Privacy
- [x] Filter `queueList` in `apps/dokploy/server/api/routers/deployment.ts`:
  - [x] Enforce `jobOrgId === orgId` for tenant users. Customer A cannot view or infer Customer B's jobs or metadata.
  - [x] Platform administrator exception (`isPlatformAdmin` / `owner`) preserves central visibility for ops.

## Phase 6: Automated Concurrency & Isolation Test Suite
- [x] Create Vitest test suite (`apps/dokploy/__test__/queues/tenant-isolated-concurrency.test.ts`):
  - [x] Real concurrent execution overlap between Tenant A and Tenant B.
  - [x] Fast build for Tenant B completes while slow build for Tenant A is running.
  - [x] Fair scheduling: Tenant A submitting multiple builds does not starve Tenant B.
  - [x] Service serialization: Two builds of the same app serialize safely; different apps run concurrently.
  - [x] Cancellation safety: Cancelling Tenant A's build does not affect Tenant B's active build.
  - [x] Queue listing isolation: Tenant A cannot see Tenant B's queued or active jobs.
- [x] Full monorepo verification and typecheck (`pnpm -r run typecheck`).
