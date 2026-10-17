import {
	buildDatabaseConnectionStrings,
	verifyDatabaseConnectivity,
} from "@dokploy/server/services/database-connection";
import type { ApplicationNested } from "@dokploy/server/utils/builders/index";
import { buildContainerEnvironmentVariables } from "@dokploy/server/utils/builders/index";
import {
	classifyLogLine,
	evaluateDeploymentOutcome,
} from "@dokploy/server/utils/deployment/classification";
import { describe, expect, it } from "vitest";
import { getLogType } from "@/components/dashboard/docker/logs/utils";

describe("Warning Classification, Backend Readiness, and Database Connectivity", () => {
	describe("1. Deployment Warning versus Error Classification", () => {
		it("classifies npm funding notices as informational without failing builds", () => {
			const fundingLine =
				"110 packages are looking for funding. run `npm fund` for details";
			const classified = classifyLogLine(fundingLine);
			expect(classified.severity).toBe("info");
			expect(classified.isInformational).toBe(true);
			expect(classified.isSecurityWarning).toBe(false);

			const logStyle = getLogType(fundingLine);
			expect(logStyle.type).toBe("info");
		});

		it("classifies npm audit notices as non-fatal security warnings with remediation", () => {
			const auditLine =
				"found 3 vulnerabilities (1 moderate, 2 high). run npm audit fix to address them";
			const classified = classifyLogLine(auditLine);
			expect(classified.severity).toBe("warning");
			expect(classified.category).toBe("security");
			expect(classified.isSecurityWarning).toBe(true);
			expect(classified.remediation).toBeDefined();

			const logStyle = getLogType(auditLine);
			expect(logStyle.type).toBe("warning");
		});

		it("classifies Docker SecretsUsedInArgOrEnv as non-fatal security warning with remediation", () => {
			const dockerWarning =
				"SecretsUsedInArgOrEnv: Sensitive data should not be used in 'ENV' or 'ARG' instructions";
			const classified = classifyLogLine(dockerWarning);
			expect(classified.severity).toBe("warning");
			expect(classified.category).toBe("security");
			expect(classified.isSecurityWarning).toBe(true);
			expect(classified.remediation).toContain("Docker build secrets");

			const logStyle = getLogType(dockerWarning);
			expect(logStyle.type).toBe("warning");
		});

		it("evaluates successful image build plus healthy application as successful deployment", () => {
			const outcome = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: true,
				isContainerRunning: true,
				isUrlResponding: true,
			});
			expect(outcome.status).toBe("done");
			expect(outcome.severity).toBe("success");
		});

		it("evaluates successful build with security warnings as successful deployment with warning severity", () => {
			const outcome = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: true,
				isContainerRunning: true,
				isUrlResponding: true,
				hasSecurityWarnings: true,
			});
			expect(outcome.status).toBe("done");
			expect(outcome.severity).toBe("warning");
			expect(outcome.diagnosticNotice).toContain(
				"Non-fatal dependency warnings",
			);
		});

		it("evaluates temporary 502 followed by successful readiness as success with a recorded warning", () => {
			const outcome = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: true,
				isContainerRunning: true,
				isUrlResponding: true,
				hasTransientWarmup: true,
			});
			expect(outcome.status).toBe("done");
			expect(outcome.severity).toBe("warning");
			expect(outcome.message).toContain(
				"transient HTTP 502 during container warmup",
			);
		});

		it("evaluates persistent 502 for an HTTP workload as a genuine readiness failure", () => {
			const outcome = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: true,
				isContainerRunning: true,
				isUrlResponding: false,
			});
			expect(outcome.status).toBe("error");
			expect(outcome.severity).toBe("error");
			expect(outcome.message).toContain("Persistent HTTP 502 Bad Gateway");
		});

		it("does not subject background worker workloads to HTTP URL readiness checks", () => {
			const outcome = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: false,
				isContainerRunning: true,
				isUrlResponding: false, // Worker has no HTTP listener
			});
			expect(outcome.status).toBe("done");
			expect(outcome.message).toContain(
				"Background worker service converged and is running normally",
			);
		});

		it("treats real compilation errors and fatal crashes as failures", () => {
			const buildCrash = evaluateDeploymentOutcome({
				buildExitCode: 1,
				isHttpWorkload: true,
				isContainerRunning: false,
			});
			expect(buildCrash.status).toBe("error");

			const runtimeCrash = evaluateDeploymentOutcome({
				buildExitCode: 0,
				isHttpWorkload: true,
				isContainerRunning: false,
			});
			expect(runtimeCrash.status).toBe("error");
			expect(runtimeCrash.message).toContain(
				"Container task failed to converge or exited prematurely",
			);
		});
	});

	describe("2. Backend Readiness & Runtime Port Propagation", () => {
		it("injects 0.0.0.0 binding and target port for backend application runtimes", () => {
			const fakeApp = {
				appName: "backend-api",
				env: "",
				sourceType: "github",
				buildType: "nixpacks",
				applicationStatus: "idle",
				domains: [],
				environment: { project: { env: "" }, env: "" },
			} as unknown as ApplicationNested;

			const explicitPlan = {
				port: {
					value: 8080,
					source: "customer_override",
					bindAddress: "0.0.0.0",
				},
				isHttpWorkload: true,
			};

			const envVars = buildContainerEnvironmentVariables(fakeApp, explicitPlan);

			expect(envVars).toContain("HOST=0.0.0.0");
			expect(envVars).toContain("NIXPACKS_HOST=0.0.0.0");
			expect(envVars).toContain("FASTIFY_ADDRESS=0.0.0.0");
			expect(envVars).toContain("UVICORN_HOST=0.0.0.0");
			expect(envVars).toContain("PORT=8080");
			expect(envVars).toContain("NIXPACKS_PORT=8080");
			expect(envVars).toContain("UVICORN_PORT=8080");
			expect(envVars).toContain("ASPNETCORE_URLS=http://0.0.0.0:8080");
		});
	});

	describe("3. Database Connectivity & Endpoint Generation", () => {
		it("correctly encodes credentials containing special characters in connection URIs", () => {
			const record = {
				appName: "mongo-secure",
				databaseUser: "admin_user",
				databasePassword: "p@ssword#with:special?chars&more=1",
				databaseName: "customer_db",
				externalPort: 27017,
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				record,
				"db.hatdot.cloud",
			);

			expect(conn.external.isEnabled).toBe(true);
			// Password special characters must be percent-encoded in the connection URI
			expect(conn.external.url).toContain(
				encodeURIComponent("p@ssword#with:special?chars&more=1"),
			);
			// MongoDB standalone connections must include directConnection=true for MongoDB Compass
			expect(conn.external.url).toContain("directConnection=true");
			expect(conn.external.url).toContain("authSource=customer_db");
			// Raw password must remain intact for single env variable consumption
			expect(conn.envVariables.MONGO_PASSWORD).toBe(
				"p@ssword#with:special?chars&more=1",
			);
		});

		it("includes replicaSet query when configured for MongoDB clusters", () => {
			const record = {
				appName: "mongo-replica",
				databaseUser: "admin",
				databasePassword: "secretpassword",
				databaseName: "app_db",
				externalPort: 27017,
				replicaSets: "rs0",
			};

			const conn = buildDatabaseConnectionStrings(
				"mongo",
				record,
				"db.hatdot.cloud",
			);

			expect(conn.external.url).toContain("replicaSet=rs0");
			expect(conn.external.url).not.toContain("directConnection=true");
		});

		it("marks internal-only databases as not externally enabled when externalPort is null", () => {
			const record = {
				appName: "postgres-internal",
				databaseUser: "pg_user",
				databasePassword: "pg_password",
				databaseName: "pg_db",
				externalPort: null,
			};

			const conn = buildDatabaseConnectionStrings(
				"postgres",
				record,
				"db.hatdot.cloud",
			);

			expect(conn.external.isEnabled).toBe(false);
			expect(conn.external.url).toBeNull();
			expect(conn.internal.url).toBe(
				"postgresql://pg_user:pg_password@postgres-internal:5432/pg_db",
			);
		});

		it("handles database connectivity verification for disabled public access", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "db.hatdot.cloud",
				port: null,
			});

			expect(result.isConfigured).toBe(false);
			expect(result.dnsStatus).toBe("unconfigured");
			expect(result.tcpStatus).toBe("unconfigured");
			expect(result.message).toContain(
				"Public external access is currently disabled",
			);
		});

		it("accurately diagnoses DNS lookup failures (ENOTFOUND)", async () => {
			const result = await verifyDatabaseConnectivity({
				type: "mongo",
				host: "unresolvable-fake-db-domain-xyz987654321.cloud",
				port: 27017,
			});

			expect(result.isConfigured).toBe(true);
			expect(result.dnsStatus).toBe("failed");
			expect(result.diagnostics?.errorCode).toBe("ENOTFOUND");
			expect(result.message).toContain("DNS resolution failed");
		});
	});
});
