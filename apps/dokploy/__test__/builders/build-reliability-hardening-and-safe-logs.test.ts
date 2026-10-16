import { describe, expect, it } from "vitest";
import {
	resolveRolldownBindingTarget,
	getNativeModuleCacheKey,
	planNativeBindingResolution,
	buildConstrainedRecoveryCommand,
	generateNativeBindingPreflightScript,
} from "@dokploy/server/utils/builders/native-dependency-resolver";
import {
	redactSensitiveInformation,
	DIAGNOSTIC_CATALOG,
} from "@dokploy/server/utils/deployment/diagnostics";
import {
	sanitizeLogContent,
	transformLogForAudience,
	transformChunkForAudience,
	createDiagnosticEvent,
	CUSTOMER_STAGE_PROGRESS,
	isUserAdmin,
} from "@dokploy/server/utils/deployment/logging-boundary";
import { generateNixpacksToml } from "@dokploy/server/utils/builders/runtime-resolver";
import { getNixpacksCommand } from "@dokploy/server/utils/builders/nixpacks";
import type { ApplicationNested } from "@dokploy/server/utils/builders";

const createTestApp = (name: string, overrides: Partial<ApplicationNested> = {}): ApplicationNested =>
	({
		applicationId: `app-${name}`,
		appName: name,
		name,
		buildType: "nixpacks",
		sourceType: "github",
		env: "",
		publishDirectory: null,
		isStaticSpa: false,
		cleanCache: false,
		createEnvFile: true,
		railpackVersion: "0.15.4",
		herokuVersion: "24",
		dockerfile: "Dockerfile",
		dockerContextPath: null,
		dockerBuildStage: null,
		buildPath: "/",
		command: null,
		args: [],
		memoryLimit: null,
		memoryReservation: null,
		cpuLimit: null,
		cpuReservation: null,
		restartPolicySwarm: null,
		placementSwarm: null,
		updateConfigSwarm: null,
		rollbackConfigSwarm: null,
		modeSwarm: null,
		networkSwarm: null,
		labelsSwarm: null,
		healthCheckSwarm: null,
		stopGracePeriodSwarm: null,
		ulimitsSwarm: null,
		endpointSpecSwarm: null,
		serverId: null,
		buildServerId: null,
		applicationStatus: "idle",
		createdAt: new Date().toISOString(),
		description: "",
		icon: null,
		customGitUrl: "https://github.com/example/repo.git",
		customGitBranch: "main",
		customGitBuildPath: "",
		customGitSSHKeyId: null,
		environmentId: "env-1",
		autoDeploy: true,
		mounts: [],
		security: [],
		redirects: [],
		ports: [],
		registry: null,
		buildRegistry: null,
		rollbackRegistry: null,
		environment: {
			environmentId: "env-1",
			name: "production",
			isDefault: false,
			createdAt: new Date().toISOString(),
			description: "",
			projectId: "proj-1",
			env: "",
			project: {
				projectId: "proj-1",
				name: "Production Project",
				description: "",
				createdAt: new Date().toISOString(),
				organizationId: "org-1",
				env: "",
			},
		},
		...overrides,
	} as ApplicationNested);

describe("HatDot Build Reliability Hardening & Customer-Safe Deployment Logs", () => {
	// 1. Missing Rolldown binding recovery & architecture identification
	describe("1. Native Dependency Resolution & Architecture Matching", () => {
		it("resolves exact @rolldown/binding-linux-x64-gnu for x86_64 glibc", () => {
			const target = resolveRolldownBindingTarget("x86_64", "gnu");
			expect(target.isSupported).toBe(true);
			expect(target.packageName).toBe("@rolldown/binding-linux-x64-gnu");
			expect(target.architecture).toBe("x86_64");
		});

		it("resolves exact @rolldown/binding-linux-arm64-gnu for aarch64 glibc", () => {
			const target = resolveRolldownBindingTarget("aarch64", "gnu");
			expect(target.isSupported).toBe(true);
			expect(target.packageName).toBe("@rolldown/binding-linux-arm64-gnu");
			expect(target.architecture).toBe("aarch64");
		});

		it("resolves musl native bindings when running under Alpine or musl Linux", () => {
			const targetX64Musl = resolveRolldownBindingTarget("x86_64", "musl");
			expect(targetX64Musl.packageName).toBe("@rolldown/binding-linux-x64-musl");

			const targetArmMusl = resolveRolldownBindingTarget("arm64", "musl");
			expect(targetArmMusl.packageName).toBe("@rolldown/binding-linux-arm64-musl");
		});

		it("recovers missing binding only when compatible package and architecture are identified", () => {
			const plan = planNativeBindingResolution({
				packageJson: { dependencies: { rolldown: "1.2.13" } },
				installedRolldownVersion: "1.2.13",
				currentArch: "x86_64",
				packageManager: "npm",
			});

			expect(plan.status).toBe("needs_recovery");
			expect(plan.bindingPackage).toBe("@rolldown/binding-linux-x64-gnu");
			expect(plan.requiredVersion).toBe("1.2.13");
			expect(plan.recoveryCommand).toContain('npm install "@rolldown/binding-linux-x64-gnu@1.2.13" --no-save');
		});
	});

	// 2. Valid native bindings are not unnecessarily replaced
	describe("2. Valid Native Bindings Preservation", () => {
		it("does not reinstall or replace when binding is already present and matches version", () => {
			const plan = planNativeBindingResolution({
				packageJson: { dependencies: { rolldown: "1.2.13" } },
				installedRolldownVersion: "1.2.13",
				installedBindingVersion: "1.2.13",
				currentArch: "x86_64",
			});

			expect(plan.status).toBe("already_valid");
			expect(plan.recoveryCommand).toBeUndefined();
		});
	});

	// 3. Unsupported architectures and incompatible versions fail safely
	describe("3. Architecture & Version Incompatibility Fail-Safes", () => {
		it("fails safely with classified diagnostic on unsupported architecture (e.g. riscv64, armv7l, s390x)", () => {
			const riscv = resolveRolldownBindingTarget("riscv64");
			expect(riscv.isSupported).toBe(false);
			expect(riscv.unsupportedReason).toContain("Rolldown does not publish prebuilt native binaries");

			const armv7 = planNativeBindingResolution({
				packageJson: { dependencies: { rolldown: "1.2.13" } },
				currentArch: "armv7l",
			});
			expect(armv7.status).toBe("unsupported_architecture");
			expect(armv7.diagnosticCode).toBe("UNSUPPORTED_NATIVE_ARCHITECTURE");
			expect(armv7.remediation).toBeDefined();
		});

		it("flags incompatible installed native binding version and generates exact aligned recovery", () => {
			const plan = planNativeBindingResolution({
				packageJson: { dependencies: { rolldown: "1.2.13" } },
				installedRolldownVersion: "1.2.13",
				installedBindingVersion: "1.1.0", // Stale or mismatched cached binding
				currentArch: "x86_64",
			});

			expect(plan.status).toBe("incompatible_version");
			expect(plan.diagnosticCode).toBe("INCOMPATIBLE_NATIVE_BINDING_VERSION");
			expect(plan.recoveryCommand).toContain("@rolldown/binding-linux-x64-gnu@1.2.13");
		});
	});

	// 4. Lockfile integrity & Package Manager respect
	describe("4. Lockfile Integrity & Package Manager Behavior", () => {
		it("generates package-manager-specific constrained recovery commands with --no-save", () => {
			const npmCmd = buildConstrainedRecoveryCommand({
				packageManager: "npm",
				packageName: "@rolldown/binding-linux-x64-gnu",
				version: "1.2.13",
			});
			expect(npmCmd).toBe('npm install "@rolldown/binding-linux-x64-gnu@1.2.13" --no-save --ignore-scripts=false');

			const pnpmCmd = buildConstrainedRecoveryCommand({
				packageManager: "pnpm",
				packageName: "@rolldown/binding-linux-x64-gnu",
				version: "1.2.13",
			});
			expect(pnpmCmd).toBe('pnpm add --save-optional=false --save-exact=false "@rolldown/binding-linux-x64-gnu@1.2.13"');

			const bunCmd = buildConstrainedRecoveryCommand({
				packageManager: "bun",
				packageName: "@rolldown/binding-linux-x64-gnu",
				version: "1.2.13",
			});
			expect(bunCmd).toBe('bun add --no-save "@rolldown/binding-linux-x64-gnu@1.2.13"');

			const yarnCmd = buildConstrainedRecoveryCommand({
				packageManager: "yarn",
				packageName: "@rolldown/binding-linux-x64-gnu",
				version: "1.2.13",
			});
			expect(yarnCmd).toBe('yarn add --optional "@rolldown/binding-linux-x64-gnu@1.2.13"');
		});

		it("preflight shell script verifies architecture, checks existing binding, and fails safely on unsupported arch", () => {
			const script = generateNativeBindingPreflightScript("npm");
			expect(script).toContain("x86_64|amd64) BINDING_PKG=\"@rolldown/binding-linux-x64-gnu\"");
			expect(script).toContain("aarch64|arm64) BINDING_PKG=\"@rolldown/binding-linux-arm64-gnu\"");
			expect(script).toContain("UNSUPPORTED_NATIVE_ARCHITECTURE");
			expect(script).toContain("already installed and valid");
			expect(script).toContain("exit 1");
		});
	});

	// 5. Incompatible cached modules isolation
	describe("5. Dependency Cache Isolation", () => {
		it("creates architecture- and OS-isolated cache keys", () => {
			const x64Key = getNativeModuleCacheKey({
				packageName: "@rolldown/binding",
				version: "1.2.13",
				os: "linux",
				architecture: "x86_64",
				libc: "gnu",
			});
			const arm64Key = getNativeModuleCacheKey({
				packageName: "@rolldown/binding",
				version: "1.2.13",
				os: "linux",
				architecture: "aarch64",
				libc: "gnu",
			});
			const muslKey = getNativeModuleCacheKey({
				packageName: "@rolldown/binding",
				version: "1.2.13",
				os: "linux",
				architecture: "x86_64",
				libc: "musl",
			});

			expect(x64Key).not.toBe(arm64Key);
			expect(x64Key).not.toBe(muslKey);
			expect(x64Key).toBe("native-cache::@rolldown/binding@1.2.13::linux-x86_64-gnu");
			expect(arm64Key).toBe("native-cache::@rolldown/binding@1.2.13::linux-aarch64-gnu");
		});
	});

	// 6. Trace and fix the npm warning
	describe("6. npm Deprecation Warning Fix (Use --omit=dev instead)", () => {
		it("nixpacks.toml includes variables section unsetting legacy NPM_CONFIG_PRODUCTION", () => {
			const toml = generateNixpacksToml({
				installCmd: "npm ci --include=dev --include=optional",
				buildCmd: "npm run build",
			});

			expect(toml).toContain("[variables]");
			expect(toml).toContain('NPM_CONFIG_PRODUCTION = ""');
			expect(toml).toContain('NPM_CONFIG_UPDATE_NOTIFIER = "false"');
		});

		it("nixpacks preflight script unsets NPM_CONFIG_PRODUCTION before executing npm commands", () => {
			const app = createTestApp("npm-warn-test");
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain("unset NPM_CONFIG_PRODUCTION");
			expect(cmd).toContain('export NPM_CONFIG_PRODUCTION=""');
		});
	});

	// 7. Build-time tools and runtime dependencies preserved
	describe("7. Build-Time Tools & Runtime Dependencies Preservation", () => {
		it("includes devDependencies for build phase so TypeScript and Vite are accessible", () => {
			const app = createTestApp("vite-ts-app");
			const cmd = getNixpacksCommand(app);

			expect(cmd).toContain("npm ci --include=dev --include=optional");
		});
	});

	// 8. Customer APIs never expose raw infrastructure commands or internal identifiers
	describe("8. Customer-Safe Logging Boundary Protection", () => {
		const rawAdminLog = `
Stage 1/7: Configuration & Framework Detection
Selected Builder: nixpacks
docker service update --image haly-myapp:latest --replicas 1
task 31e3b2a4-b570-496c-bdf1-1086f3104b9d converged in docker swarm
export NIXPACKS_PATH="/nix/store/abc"
export NIXPACKS_INSTALL_CMD="npm ci"
Pulling image sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
Container ID: 7a8b9c0d1e2f3a4b5c6d7e8f
Internal network 10.0.1.45 connected via dokploy-network
File written to /etc/dokploy/applications/my-app/deployments/123.log
Vite v5.4.2 building for production...
dist/index.html   0.45 kB
dist/assets/index.js   145.20 kB
✓ built in 420ms
`;

		it("strips raw Docker commands, internal filesystem paths, and task IDs for customer view", () => {
			const customerLog = transformLogForAudience(rawAdminLog, "customer");

			// Raw Docker and swarm details must not appear
			expect(customerLog).not.toContain("docker service update");
			expect(customerLog).not.toContain("converged in docker swarm");
			expect(customerLog).not.toContain("export NIXPACKS_");
			expect(customerLog).not.toContain("/etc/dokploy");
			expect(customerLog).not.toContain("7a8b9c0d1e2f3a4b5c6d7e8f");
			expect(customerLog).not.toContain("10.0.1.45");
			expect(customerLog).not.toContain("dokploy-network");

			// Customer build output and friendly headings must be preserved
			expect(customerLog).toContain("Vite v5.4.2 building for production");
			expect(customerLog).toContain("dist/index.html");
			expect(customerLog).toContain("dist/assets/index.js");
			expect(customerLog).toContain("Step 1/7: Preparing Application & Detecting Framework");
		});

		it("preserves full technical diagnostics for authorized admin view", () => {
			const adminLog = transformLogForAudience(rawAdminLog, "admin");

			expect(adminLog).toContain("docker service update");
			expect(adminLog).toContain("converged in docker swarm");
			expect(adminLog).toContain("Vite v5.4.2 building for production");
		});
	});

	// 9. Secrets are redacted before persistence (Adversarial Fixtures)
	describe("9. Adversarial Secret Redaction Before Persistence", () => {
		it("redacts database URIs with passwords in multiline log streams", () => {
			const raw = `
Initializing environment...
DATABASE_URL="postgresql://postgres:SuperSecretP@ssw0rd!@db.internal:5432/production_db"
REDIS_URL='redis://:RedisAuthToken12345@redis-cluster:6379/0'
`;
			const sanitized = sanitizeLogContent(raw);
			expect(sanitized).not.toContain("SuperSecretP@ssw0rd!");
			expect(sanitized).not.toContain("RedisAuthToken12345");
			expect(sanitized).toContain("postgresql://postgres:••••••••@db.internal:5432/production_db");
		});

		it("redacts private keys (RSA / OpenSSH)", () => {
			const raw = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y3yZ2...fake...private...key...data...
-----END RSA PRIVATE KEY-----
Deploying SSH key...
`;
			const sanitized = sanitizeLogContent(raw);
			expect(sanitized).not.toContain("MIIEowIBAAKCAQEA0Y3yZ2");
			expect(sanitized).toContain("[REDACTED PRIVATE KEY]");
		});

		it("redacts Authorization Bearer tokens, Basic auth, and command flags", () => {
			const raw = `
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload.sig" https://api.example.com
curl -u admin:SecretPassword123 https://api.example.com
node server.js --token=my_secret_token_abc123 --password SuperSecretPass
`;
			const sanitized = sanitizeLogContent(raw);
			expect(sanitized).not.toContain("secretpayload.sig");
			expect(sanitized).not.toContain("my_secret_token_abc123");
			expect(sanitized).not.toContain("SuperSecretPass");
			expect(sanitized).toContain("Bearer ••••••••");
		});
	});

	// 10. Unknown exceptions do not leak raw stack traces to customers
	describe("10. Raw Stack Trace & Unknown Exception Masking", () => {
		const rawError = `
Error: ENOENT: no such file or directory, open '/etc/dokploy/internal.json'
    at Object.openSync (node:fs:580:18)
    at Object.readFileSync (node:fs:459:35)
    at buildApplicationInternal (C:/Users/hosting/dokploy/packages/server/src/services/application.ts:742:15)
    at async deployApplication (C:/Users/hosting/dokploy/packages/server/src/services/application.ts:890:5)
`;

		it("masks raw node stack traces for customer audience", () => {
			const customerLog = transformLogForAudience(rawError, "customer");

			expect(customerLog).not.toContain("at Object.openSync");
			expect(customerLog).not.toContain("at buildApplicationInternal");
			expect(customerLog).not.toContain("/etc/dokploy/internal.json");
		});

		it("preserves stack traces for admin audience for debugging", () => {
			const adminLog = transformLogForAudience(rawError, "admin");

			expect(adminLog).toContain("at Object.openSync");
			expect(adminLog).toContain("at buildApplicationInternal");
		});
	});

	// 11. Role-based authorization helpers
	describe("11. Role-Based Authorization & Access Control", () => {
		it("correctly identifies owner, admin, and platform admin", () => {
			expect(isUserAdmin({ role: "owner" })).toBe(true);
			expect(isUserAdmin({ role: "admin" })).toBe(true);
			expect(isUserAdmin({ role: "member", isPlatformAdmin: true })).toBe(true);
			expect(isUserAdmin({ role: "member" })).toBe(false);
			expect(isUserAdmin({ role: "viewer" })).toBe(false);
			expect(isUserAdmin(null)).toBe(false);
		});
	});

	// 12. Streaming chunk transformation
	describe("12. Streaming Chunk Transformation", () => {
		it("transforms streaming chunks on-the-fly for customer WebSocket clients", () => {
			const chunk = `docker service scale app=1\nVite v5.4.2 building for production...`;
			const customerChunk = transformChunkForAudience(chunk, "customer");

			expect(customerChunk).not.toContain("docker service scale");
			expect(customerChunk).toContain("Vite v5.4.2 building for production");
		});
	});

	// 13. Customer-Facing Progress Lifecycle
	describe("13. Meaningful Customer-Facing Progress Lifecycle", () => {
		it("emits structured diagnostic events with customer-friendly messages", () => {
			const event = createDiagnosticEvent({
				deploymentId: "dep-1",
				applicationId: "app-1",
				stageNum: "4",
				status: "running",
			});

			expect(event.stage).toBe("Stage 4/7");
			expect(event.customerMessage).toBe("Building your production application and compiling static assets...");
			expect(event.progressPercent).toBe(65);
		});

		it("includes remediation advice for classified diagnostic errors", () => {
			const event = createDiagnosticEvent({
				deploymentId: "dep-1",
				applicationId: "app-1",
				stageNum: "1",
				status: "error",
				diagnosticCode: "UNSUPPORTED_NATIVE_ARCHITECTURE",
			});

			expect(event.diagnosticCode).toBe("UNSUPPORTED_NATIVE_ARCHITECTURE");
			expect(event.customerMessage).toContain("prebuilt native binaries");
			expect(event.recommendedAction).toBeDefined();
		});
	});

	// 14. Diagnostic Catalog Integrity
	describe("14. Diagnostic Catalog Completeness", () => {
		it("contains comprehensive descriptions for native dependency failures", () => {
			expect(DIAGNOSTIC_CATALOG.UNSUPPORTED_NATIVE_ARCHITECTURE.remediation).toBeDefined();
			expect(DIAGNOSTIC_CATALOG.NATIVE_BINDING_RESOLUTION_FAILED.remediation).toBeDefined();
			expect(DIAGNOSTIC_CATALOG.INCOMPATIBLE_NATIVE_BINDING_VERSION.remediation).toBeDefined();
			expect(DIAGNOSTIC_CATALOG.UNKNOWN_BUILD_ERROR.remediation).toBeDefined();
		});
	});
});
