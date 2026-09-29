# HATDOT — FULL COMMERCIAL PAAS CONTROL PLANE & ENTITLEMENT SPECIFICATION

## Overview
This document serves as the master specification and implementation blueprint for turning HatDot into a production-ready Commercial PaaS built on top of Dokploy.

---

## 1. Architectural Topology & Routing
- **Public Landing Page**: `https://hatdot.cloud` (Public marketing, dynamic pricing from DB, signup/signin entry points)
- **HatDot Control Plane**: `https://panel2021.hatdot.cloud` (Dokploy Infra & Customer Application Management)
- **Platform Admin Panel**: `https://panel2021.hatdot.cloud/admin` (Real-time MRR, plans management, customer directory, server node capacity, audit logs)
- **Customer Apps**: `*.hatdot.cloud` & custom domains routed automatically via Traefik.

---

## 2. Database Entities (`paas_*`)
- `paas_plan`: Plan details, prices, billing cycles, active status, trial days, metadata.
- `paas_plan_resource`: Resource quotas per plan (max projects, applications, databases, domains, CPU millicores, RAM MB, storage GB, bandwidth GB).
- `paas_plan_feature`: Boolean feature flags per plan (SSL auto, custom domains, backups, API access, team collaboration).
- `paas_plan_app_type`: Supported app types per plan (`static`, `node`, `php`, `python`, `docker`, `compose`).
- `paas_subscription`: Organization subscription lifecycle (`trial`, `pending_payment`, `active`, `past_due`, `grace_period`, `suspended`, `cancelled`, `expired`).
- `paas_invoice`: Billing invoices, line items, currency, status, due dates.
- `paas_payment`: Payment transaction records, provider references (`mpesa`, `tigopesa`, `airtelmoney`, `card`, etc.), payment status.
- `paas_credit`: Organization billing credits.
- `paas_coupon`: Promotional discount codes.
- `paas_usage_record`: Granular resource consumption snapshots.
- `paas_support_ticket` & `paas_support_message`: Customer support ticketing system.
- `paas_server_capacity`: Cluster node hardware specs, CPU/RAM/Disk capacity, safety reserve percentages, and heartbeats.
- `paas_platform_setting`: Key-value platform settings (registration status, trial lengths, grace period days, retention rules).
- `paas_audit_log`: Admin & system security audit log.

---

## 3. Real Admin Authorization & Security
- `isPlatformAdmin` column on `user` table is checked strictly server-side using `platformAdminProcedure`.
- Client-side routes at `/admin/*` enforce authentication & `isPlatformAdmin` verification, redirecting unauthorized users to `/dashboard` or `/login`.
- Zero hardcoded mock metrics ($14,280, 412 customers, fake plans). All metrics are queried from live PostgreSQL data.

---

## 4. Server-Side Entitlement & Enforcement Engine
- Centralized entitlement checking before any project, application, database, or domain creation.
- Docker CPU & Memory container constraints configured according to active plan limits.
- Over-limit handling for downgrades & clear user feedback on plan quota exhaustion.

---

## 5. Master Implementation Status
- [x] Specification documented & saved
- [x] Phase 1: Database schema & migration audit (Migrations 0197 and 0198 registered)
- [x] Phase 2: tRPC Backend Routers (`planRouter`, `subscriptionRouter`, `adminRouter`, `PlanEntitlementService`)
- [x] Phase 3: Replace mock UI components in `/admin` with live tRPC queries (`dashboardStats`, `listCustomers`, `listServers`, `adminList`)
- [x] Phase 4: Entitlement enforcement & server-side authorization (`platformAdminProcedure`, `PlanEntitlementService`)
- [x] Phase 5: Client-side auth guard & dynamic pricing query integration
- [x] Phase 6: Build verification & deployment preparation
