# HatDot Universal Build & Deployment Engine Guide
*Production-grade application hosting without server administration, Docker wrestling, or Linux maintenance.*

---

## 1. Overview & Architecture

HatDot is an intelligent, multi-builder cloud deployment engine built for web developers and modern engineering teams. It allows applications across multiple languages and runtimes to be deployed seamlessly from source code (GitHub, GitLab, Bitbucket, Gitea, or direct Git).

### The Multi-Builder Hierarchy
When a deployment is initiated, HatDot inspects the source repository and resolves the best build strategy:
1. **Explicit Config (`hatdot.yaml` / `hatdot.yml`)**: If a developer specifies a builder, HatDot adheres to the configuration.
2. **Custom Dockerfile (`Dockerfile`)**: If a `Dockerfile` exists at the project root (or specified path), HatDot defaults to Dockerfile native build unless overridden.
3. **Railpack Multi-Layer Builder**: Preferred for fast, cached builds across standard modern frameworks (Next.js, Vite, Laravel, Go, Rust, Python).
4. **Nixpacks Universal Builder**: Fallback and universal runtime builder supporting 100+ languages, system packages, and complex toolchains.
5. **Static Site Engine**: Zero-server Nginx deployment for static HTML/CSS/JS, Vite SSG, Astro, or exported client apps.
6. **Docker Compose**: For multi-service distributed stacks.

---

## 2. Declarative Project Configuration: `hatdot.yaml`

Developers can customize their builds by committing a `hatdot.yaml` or `hatdot.yml` file to the root of the project or subfolder.

```yaml
version: 1

project:
  name: "my-web-app"
  type: "web"          # web, worker, cron, static
  root: "./"           # project root path (monorepo support)

build:
  builder: "railpack"  # railpack | nixpacks | dockerfile | static | buildpacks | compose
  runtime: "nodejs"    # nodejs, python, php, ruby, go, rust, java, dotnet, elixir, static
  runtimeVersion: "22"
  packageManager: "pnpm"
  installCommand: "pnpm install --frozen-lockfile"
  buildCommand: "pnpm run build"
  outputDirectory: ".next"
  systemPackages:
    - "libvips-dev"
    - "ffmpeg"
  env:
    NODE_ENV: "production"
    APP_BASE_URL: "${PLATFORM_DOMAIN:-https://app.example.com}"

run:
  startCommand: "pnpm run start"
  port: 3000
  env:
    PORT: "3000"

deploy:
  replicas: 1
  restartPolicy: "any"
  healthcheck:
    path: "/api/health"
    status: 200
    timeoutSeconds: 5
    intervalSeconds: 15
    retries: 3
```

### Environment Variable Interpolation
Values inside `hatdot.yaml` support safe expansion:
- `${VARIABLE}`: Expands from application environment variables.
- `${VARIABLE:-default_value}`: Expands with a fallback if undefined.
- Secrets are never logged or exposed in diagnostic outputs.

---

## 3. Supported Application Types & Detection Matrix

| Runtime / Framework | Primary Indicators | Default Builder | Default Port | Contradiction Guard |
| :--- | :--- | :--- | :--- | :--- |
| **Static Site** | `index.html` (no server package) | `static` | 80 | Prevents server wrappers |
| **Vite / SPA** | `vite.config.*`, `package.json` | `railpack` / `nixpacks` | 4173 (preview) / 80 | Prevents port 3000 assumption |
| **Next.js** | `next.config.*`, `"next"` in deps | `railpack` / `nixpacks` | 3000 | Configures standalone output |
| **Django** | `manage.py`, `wsgi.py` | `railpack` / `nixpacks` | 8000 | **Ignores frontend package.json** |
| **FastAPI / Flask** | `main.py`, `app.py`, `uvicorn` | `railpack` / `nixpacks` | 8000 / 5000 | Preserves Python runtime |
| **Laravel / PHP** | `artisan`, `composer.json` | `railpack` / `nixpacks` | 80 / 8000 | Validates PHP extensions & Artisan |
| **WordPress** | `wp-config.php`, `wp-content` | `railpack` / `nixpacks` | 80 | Ensures MySQL driver enabled |
| **Go** | `go.mod`, `main.go` | `railpack` / `nixpacks` | 8080 | Multi-stage scratch build |
| **Rust** | `Cargo.toml`, `Cargo.lock` | `railpack` / `nixpacks` | 8080 | Optimizes release compilation |
| **Java / Spring Boot** | `pom.xml`, `build.gradle` | `nixpacks` / `railpack` | 8080 | Uses JDK 17/21 LTS |
| **.NET / C#** | `*.csproj`, `*.sln` | `nixpacks` / `railpack` | 5000 / 8080 | ASPNETCORE_URLS binding |
| **Elixir / Phoenix** | `mix.exs`, `mix.lock` | `nixpacks` | 4000 | Configures distillery/release |

---

## 4. Port Management & Reverse Proxy Routing

1. **Automatic Port Discovery**:
   - HatDot inspects start commands (e.g. `--port 8080`, `-p 5000`), framework defaults, and environment variables (`$PORT`).
   - If an application binds to an unexpected port, the failure diagnosis engine detects log output (`listening on port X`) and reconciles Traefik routing automatically.
2. **Host Validation & Vite 6 Allowed Hosts**:
   - Modern Vite (v6+) and frameworks block requests with `HTTP 403: Blocked Host` when accessed through a reverse proxy.
   - HatDot automatically resolves all authorized domains, CNAMEs, and platform hosts and injects `preview.allowedHosts = true` or explicit host headers into the build runtime.
3. **Zero-Downtime Traffic Switching**:
   - Traefik reverse proxy routes incoming traffic only after Stage 6 (Task Convergence) and Stage 7 (End-to-End HTTP Probe) pass.
   - If a new deployment fails, previous healthy containers remain active.

---

## 5. Monorepo Configuration

For monorepos (Turborepo, Nx, PNPM/Yarn/npm workspaces):
1. Specify the target package in `hatdot.yaml`:
   ```yaml
   project:
     root: "apps/web"
   ```
2. Or configure `Base Directory` in the HatDot dashboard.
3. HatDot automatically checks root workspace lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`) to resolve dependencies without breaking workspace references.

---

## 6. Troubleshooting & The 16 Platform Error Codes

| Error Code | Title | Likely Cause | Remediation |
| :--- | :--- | :--- | :--- |
| `RUNTIME_NOT_DETECTED` | Runtime Undetected | Missing manifest file (`package.json`, `go.mod`, etc.) | Add manifest or declare runtime in `hatdot.yaml`. |
| `PACKAGE_MANAGER_MISMATCH` | Package Manager Mismatch | Conflicting lockfiles (`pnpm-lock.yaml` vs `package-lock.json`) | Remove outdated lockfile or set `packageManager` in config. |
| `DEPENDENCY_FAILED` | Dependency Resolution Failure | Outdated lockfile or missing C compiler headers | Update lockfile or specify `systemPackages` in `hatdot.yaml`. |
| `BUILD_SYNTAX_ERROR` | Compilation / Syntax Error | TypeScript error, missing import, or compile failure | Review build logs for line error; run build locally. |
| `OUTPUT_DIRECTORY_MISSING` | Output Directory Missing | Build succeeded but dist/build directory not created | Verify `build.outputDirectory` matches build script output. |
| `START_COMMAND_MISSING` | Start Command Undefined | Missing `npm start` script or binary executable | Add `start` script to `package.json` or specify in `hatdot.yaml`. |
| `PORT_MISMATCH` | Port Routing Mismatch | App listening on 8080 while proxy routed to 3000 | Specify `run.port` or listen on `$PORT`. Auto-reconciles if safe. |
| `HOST_VALIDATION_BLOCKED` | Host Validation 403 Blocked | Vite `allowedHosts` blocking proxy hostname | Add hostname to `preview.allowedHosts` or let HatDot auto-inject. |
| `HEALTHCHECK_TIMEOUT` | Healthcheck Timeout | App took longer than 30s to boot or crashes on start | Increase `deploy.healthcheck.timeoutSeconds` or fix crash. |
| `MISSING_ENVIRONMENT_VARIABLE` | Missing Secret / Variable | Required database URL or secret not defined | Add variable in Application Environment tab. |
| `DATABASE_CONNECTION_REFUSED` | Database Connection Failed | Database service down or host unreachable | Verify DB credentials and internal network attachment. |
| `DATABASE_MIGRATION_FAILED` | Migration Error | Migration script failed during release phase | Test migrations against clean schema; inspect DB logs. |
| `FILESYSTEM_PERMISSIONS` | Filesystem Permission Denied | App container cannot write to non-root path | Use `/tmp` or configure volume permissions. |
| `STATIC_ROUTING_ERROR` | SPA 404 Routing Error | Client router routes return 404 on refresh | HatDot configures Nginx `try_files $uri $uri/ /index.html`. |
| `DOCKERFILE_INVALID` | Invalid Dockerfile Directive | Syntax error or unsupported multi-stage target | Validate Dockerfile syntax with `docker build` locally. |
| `CONTAINER_CRASH_LOOP` | Runtime Crash Loop (OOM/Crash) | Unhandled exception or memory limit exceeded | Review container logs; increase memory limits. |

---

## 7. 14 Representative Project Deployment Configurations

### 1. Static HTML / Single Page Application
```yaml
# hatdot.yaml
version: 1
project:
  name: "static-landing"
  type: "static"
build:
  builder: "static"
  outputDirectory: "./"
run:
  port: 80
deploy:
  healthcheck:
    path: "/"
```

### 2. Vite React / Vue / Svelte
```yaml
# hatdot.yaml
version: 1
project:
  name: "vite-react-app"
build:
  builder: "railpack"
  runtime: "nodejs"
  runtimeVersion: "20"
  packageManager: "pnpm"
  buildCommand: "pnpm run build"
run:
  startCommand: "pnpm run preview -- --host 0.0.0.0 --port 4173"
  port: 4173
```

### 3. Next.js (SSR + Standalone)
```yaml
# hatdot.yaml
version: 1
project:
  name: "nextjs-storefront"
build:
  builder: "railpack"
  runtime: "nodejs"
  runtimeVersion: "22"
  packageManager: "npm"
  buildCommand: "npm run build"
run:
  startCommand: "node .next/standalone/server.js"
  port: 3000
deploy:
  healthcheck:
    path: "/api/health"
```

### 4. Django (Gunicorn + Tailwind/Vite Tooling + PostgreSQL)
```yaml
# hatdot.yaml
version: 1
project:
  name: "django-portal"
build:
  builder: "railpack"
  runtime: "python"
  runtimeVersion: "3.12"
  packageManager: "poetry"
  systemPackages:
    - "libpq-dev"
    - "gcc"
  buildCommand: "poetry run python manage.py collectstatic --noinput && poetry run python manage.py migrate"
run:
  startCommand: "poetry run gunicorn myapp.wsgi:application --bind 0.0.0.0:8000 --workers 3"
  port: 8000
deploy:
  healthcheck:
    path: "/health/"
```

### 5. Flask API
```yaml
# hatdot.yaml
version: 1
project:
  name: "flask-microservice"
build:
  builder: "railpack"
  runtime: "python"
  runtimeVersion: "3.11"
  packageManager: "pip"
  installCommand: "pip install -r requirements.txt"
run:
  startCommand: "gunicorn -w 4 -b 0.0.0.0:5000 app:app"
  port: 5000
```

### 6. FastAPI High-Performance API
```yaml
# hatdot.yaml
version: 1
project:
  name: "fastapi-service"
build:
  builder: "railpack"
  runtime: "python"
  runtimeVersion: "3.12"
  packageManager: "pip"
  installCommand: "pip install -r requirements.txt"
run:
  startCommand: "uvicorn main:app --host 0.0.0.0 --port 8000"
  port: 8000
deploy:
  healthcheck:
    path: "/health"
```

### 7. Laravel (PHP 8.3 + Artisan + Octane/Nginx-FPM)
```yaml
# hatdot.yaml
version: 1
project:
  name: "laravel-app"
build:
  builder: "railpack"
  runtime: "php"
  runtimeVersion: "8.3"
  packageManager: "composer"
  buildCommand: "composer install --no-dev --optimize-autoloader && php artisan config:cache && php artisan route:cache"
run:
  startCommand: "php artisan octane:start --server=swoole --host=0.0.0.0 --port=8000"
  port: 8000
deploy:
  healthcheck:
    path: "/up"
```

### 8. WordPress Custom Theme / Headless
```yaml
# hatdot.yaml
version: 1
project:
  name: "wordpress-site"
build:
  builder: "nixpacks"
  runtime: "php"
  runtimeVersion: "8.2"
  systemPackages:
    - "php-mysql"
    - "php-gd"
run:
  startCommand: "apache2-foreground"
  port: 80
```

### 9. Node.js Express / NestJS API
```yaml
# hatdot.yaml
version: 1
project:
  name: "nestjs-core"
build:
  builder: "railpack"
  runtime: "nodejs"
  runtimeVersion: "22"
  packageManager: "pnpm"
  buildCommand: "pnpm run build"
run:
  startCommand: "node dist/main.js"
  port: 3000
deploy:
  healthcheck:
    path: "/health"
```

### 10. Go (Fiber / Gin / Standard Net/HTTP)
```yaml
# hatdot.yaml
version: 1
project:
  name: "go-gateway"
build:
  builder: "railpack"
  runtime: "go"
  runtimeVersion: "1.23"
  buildCommand: "go build -o /app/bin/server ./main.go"
run:
  startCommand: "/app/bin/server"
  port: 8080
deploy:
  healthcheck:
    path: "/healthz"
```

### 11. Java / Kotlin Spring Boot (Maven & Gradle)
```yaml
# hatdot.yaml
version: 1
project:
  name: "spring-boot-billing"
build:
  builder: "nixpacks"
  runtime: "java"
  runtimeVersion: "21"
  packageManager: "gradle"
  buildCommand: "./gradlew bootJar --no-daemon"
run:
  startCommand: "java -jar build/libs/*.jar"
  port: 8080
deploy:
  healthcheck:
    path: "/actuator/health"
```

### 12. .NET / ASP.NET Core (C#)
```yaml
# hatdot.yaml
version: 1
project:
  name: "dotnet-api"
build:
  builder: "nixpacks"
  runtime: "dotnet"
  runtimeVersion: "8.0"
  buildCommand: "dotnet publish -c Release -o /app/out"
run:
  startCommand: "dotnet /app/out/MyApi.dll"
  port: 8080
  env:
    ASPNETCORE_URLS: "http://0.0.0.0:8080"
deploy:
  healthcheck:
    path: "/healthz"
```

### 13. Dockerfile Custom Application
```yaml
# hatdot.yaml
version: 1
project:
  name: "custom-container"
build:
  builder: "dockerfile"
run:
  port: 8080
deploy:
  healthcheck:
    path: "/ping"
```

### 14. Monorepo with Turborepo & PNPM Workspaces
```yaml
# hatdot.yaml (placed at monorepo root)
version: 1
project:
  name: "turborepo-monorepo"
  root: "apps/web"
build:
  builder: "railpack"
  runtime: "nodejs"
  runtimeVersion: "22"
  packageManager: "pnpm"
  installCommand: "pnpm install"
  buildCommand: "pnpm turbo run build --filter=web"
run:
  startCommand: "pnpm --filter=web run start"
  port: 3000
deploy:
  healthcheck:
    path: "/api/health"
```
