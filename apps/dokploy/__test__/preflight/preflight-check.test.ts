import { describe, expect, it, vi } from "vitest";
import { runPreflightCheck } from "@dokploy/server/services/preflight";

vi.mock("@dokploy/server/services/application", () => ({
	findApplicationById: vi.fn(async (appId: string) => {
		if (appId === "app-unconnected") {
			return {
				applicationId: "app-unconnected",
				appName: "unconnected-app",
				sourceType: "github",
				repository: null,
				branch: null,
				buildType: "nixpacks",
				applicationStatus: "idle",
			};
		}
		return {
			applicationId: "app-valid",
			appName: "valid-nextjs-app",
			sourceType: "github",
			repository: "user/valid-nextjs",
			branch: "main",
			buildType: "nixpacks",
			applicationStatus: "done",
		};
	}),
}));

vi.mock("@dokploy/server/services/domain", () => ({
	findDomainsByApplicationId: vi.fn(async (appId: string) => {
		if (appId === "app-valid") {
			return [
				{
					domainId: "dom-1",
					host: "valid.sslip.io",
					port: 3000,
					https: false,
				},
			];
		}
		return [];
	}),
	validateDomain: vi.fn(async () => ({ isValid: true, resolvedIp: "1.2.3.4" })),
}));

describe("Deployment Pre-flight Readiness Check", () => {
	it("should detect missing repository as a failure with fix suggestion", async () => {
		const report = await runPreflightCheck("app-unconnected");
		expect(report.ready).toBe(false);
		const repoItem = report.items.find((i) => i.id === "source-repo");
		expect(repoItem?.status).toBe("fail");
		expect(repoItem?.fixSuggestion).toBeDefined();
	});

	it("should pass readiness checks for connected application", async () => {
		const report = await runPreflightCheck("app-valid");
		expect(report.ready).toBe(true);
		const repoItem = report.items.find((i) => i.id === "source-repo");
		expect(repoItem?.status).toBe("pass");
	});
});
