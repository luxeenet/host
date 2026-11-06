# HATDOT UNIVERSAL BUILD & DEPLOYMENT ENGINE IMPLEMENTATION CHECKLIST

This checklist tracks the implementation, hardening, and verification of HatDot's Intelligent Multi-Builder Architecture, Automatic Recovery, and Production-Grade Hosting Engine.

---

## 1. Audit Existing Deployment Architecture
- [x] Inspect source ingestion (Git clone, GitHub, GitLab, Bitbucket, Gitea, Drop, Docker).
- [x] Inspect builders (`docker-file.ts`, `nixpacks.ts`, `railpack.ts`, `static.ts`, `paketo.ts`, `heroku.ts`, `compose.ts`).
- [x] Inspect framework/language detection (`app-detector.ts`).
- [x] Inspect deployment plan resolution (`deployment-plan.ts`).
- [x] Inspect deployment lifecycle in `application.ts` (Stages 1-7).
- [x] Categorize failure causes and identify architectural gaps:
  - Missing `hatdot.yaml` declarative configuration parser.
  - Inconsistent runtime and framework cross-validation (preventing Node.js runtime when Django/Python is detected).
  - Lack of structured failure diagnosis mapping raw logs to the 16 standard failure categories.
  - Safe automatic recovery engine with controlled fallback between compatible builders.
  - Zero-downtime candidate deployment lifecycle preserving prior working deployments on candidate failure.
  - Multi-tier preflight readiness check (`ready_to_build`, `ready_with_warnings`, `configuration_required`, `unsupported_project`, `infrastructure_unavailable`).
  - Builder performance analytics and admin telemetry.

## 2. Project Inspection & Builder Selection Engine
- [x] Language detection: JS/TS, Python, PHP, Ruby, Go, Rust, Java/Kotlin (JVM), .NET, Elixir, Static HTML/CSS.
- [x] Framework detection:
  - JS: React, Vite, Next.js, Nuxt, Vue, Angular, Svelte/SvelteKit, Astro, Remix, Express, NestJS, Fastify, Hono.
  - Python: Django, Flask, FastAPI, Streamlit, Celery.
  - PHP: Laravel, Symfony, WordPress, Drupal.
  - Others: Ruby on Rails, Sinatra, Go web apps, Spring Boot, Quarkus, ASP.NET Core, Phoenix, static sites.
- [x] Package managers from lockfiles: npm, pnpm, yarn, bun, pip, poetry, uv, pipenv, composer, bundler, cargo, maven, gradle, nuget, mix.
- [x] Monorepo workspace detection (pnpm, npm, yarn, turborepo, nx, lerna) with project root resolution.
- [x] Structured inspection output with confidence score, builder justification, commands, port, and unresolved assumptions.

## 3. HatDot Configuration File (`hatdot.yaml` / `hatdot.yml`)
- [x] Specification & Zod Schema for `hatdot.yaml` (version: 1) in `hatdot-config.ts`.
- [x] Support `project`, `build`, `run`, `deploy` blocks.
- [x] Environment variable substitution (`${VAR}` and `${VAR:-default}`) without leaking secrets.
- [x] Custom system packages (`systemPackages: ["ffmpeg", "libpq-dev"]`).
- [x] Backwards-compatible fallback to existing platform configuration when `hatdot.yaml` is absent.

## 4. Framework-Specific Validation & Contradiction Prevention
- [x] Prevent contradictory detections: Django/Python with frontend asset tooling (`package.json`) is not hijacked by Node.js.
- [x] Django validation: `manage.py`, WSGI/ASGI entrypoint, settings module, collectstatic, gunicorn/uvicorn.
- [x] Laravel validation: `artisan`, composer, PHP version & extensions, storage permissions.
- [x] Vite validation: package manager, build command, `dist` output directory, static/preview host configuration.
- [x] Next.js validation: standalone build output, SSR start command, port binding.

## 5. Intelligent Build Failure Diagnosis & Safe Recovery Engine
- [x] Log pattern analyzer mapping log lines to the 16 platform error types in `failure-recovery.ts`.
- [x] Structured failure report: stage, error message, root cause, evidence, remediation, safe recovery flag.
- [x] Controlled recovery manager:
  - Safe retries with exponential backoff.
  - Automatic fallback between compatible builders (e.g., Railpack -> Nixpacks).
  - Port reconciliation when app binds to an unexpected port.
  - Host validation injection for Vite/Django host header rejections.
  - Strict guardrails: max 2 attempts, never mutate customer source code, never downgrade security.
  - Clean audit reporting in deployment logs.

## 6. Deployment Safety & Production Availability
- [x] Candidate container testing before production traffic switch.
- [x] Rollback and preservation of previous running service if candidate fails.
- [x] Preservation of customer persistent volumes, databases, and environment variables.
- [x] Container warmup and health check verification before service promotion.

## 7. Build Environment & System Dependencies
- [x] Support custom OS packages across Nixpacks, Railpack, and custom Dockerfiles.
- [x] Native compilation and C-extensions support (Python C-extensions, PHP extensions, libvips, ffmpeg).
- [x] Build-time vs runtime dependency isolation.

## 8. Preflight Deployment Readiness Check
- [x] Comprehensive pre-deploy readiness check service and TRPC endpoint `application.getReadinessCheck`.
- [x] Classifications: `ready_to_build`, `ready_with_warnings`, `configuration_required`, `unsupported_project`, `infrastructure_unavailable`.
- [x] Clear diagnostic issues list for frontend presentation.

## 9. Observability & Builder Performance Analytics
- [x] Track deployment success/failure rates, failure reasons, builder distribution, build durations, recovery attempts, rollbacks.
- [x] Admin TRPC router `application.getBuilderAnalytics` in `apps/dokploy/server/api/routers/application.ts`.

## 10. Developer Documentation & Real-World Examples
- [x] Comprehensive `HATDOT_BUILD_GUIDE.md` in repository root with tested deployment configurations for all 14 required templates:
  1. Static HTML / Single Page App
  2. Vite React / Vue / Svelte
  3. Next.js (SSR + Standalone)
  4. Django (Gunicorn + Tailwind/Vite Tooling + PostgreSQL)
  5. Flask
  6. FastAPI
  7. Laravel (PHP 8.3 + Artisan + Octane/Nginx-FPM)
  8. WordPress
  9. Node.js Express / NestJS API
  10. Go (Fiber / Gin / Standard Net/HTTP)
  11. Java / Kotlin Spring Boot (Maven & Gradle)
  12. .NET / ASP.NET Core (C#)
  13. Dockerfile Custom Application
  14. Monorepo with Turborepo & PNPM Workspaces

## 11. Automated Test Suite
- [x] Unit & integration tests in `apps/dokploy/__test__/builders/hatdot-intelligent-engine.test.ts` (34/34 passing).
- [x] Full monorepo typecheck passing across all 5 workspace projects (`packages/branding`, `packages/server`, `apps/api`, `apps/schedules`, `apps/dokploy`).
