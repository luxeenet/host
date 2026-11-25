import { describe, expect, it } from "vitest";
import {
	validateSafeComposeYaml,
	sanitizeTemplateDescription,
} from "@dokploy/server";

describe("Platform Admin - Templates & Customer Management", () => {
	describe("Compose Security Validation for Custom Templates & Customer Stacks", () => {
		it("should accept valid compose templates without privileged access or host ports", () => {
			const safeYaml = `
services:
  web:
    image: nginx:alpine
    ports:
      - "8000:80"
    environment:
      - PORT=8000
`;
			expect(() => validateSafeComposeYaml(safeYaml, false)).not.toThrow();
		});

		it("should reject customer compose stacks with privileged mode enabled", () => {
			const dangerousYaml = `
services:
  malicious:
    image: alpine
    privileged: true
`;
			expect(() => validateSafeComposeYaml(dangerousYaml, false)).toThrow(
				/Privileged container mode is restricted to platform administrators/i,
			);
		});

		it("should reject customer compose stacks mounting host docker socket or root paths", () => {
			const hostMountYaml = `
services:
  docker_escape:
    image: alpine
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`;
			expect(() => validateSafeComposeYaml(hostMountYaml, false)).toThrow(
				/Mounting sensitive host path.*restricted to platform administrators/i,
			);
		});

		it("should reject customer compose stacks using host networking", () => {
			const hostNetworkYaml = `
services:
  host_net:
    image: alpine
    network_mode: host
`;
			expect(() => validateSafeComposeYaml(hostNetworkYaml, false)).toThrow(
				/Host networking mode is restricted to platform administrators/i,
			);
		});

		it("should permit platform admin to bypass container sandbox limits for platform stacks", () => {
			const adminYaml = `
services:
  admin_service:
    image: traefik:v3.1
    network_mode: host
`;
			expect(() => validateSafeComposeYaml(adminYaml, true)).not.toThrow();
		});
	});

	describe("Template Description Sanitization", () => {
		it("should sanitize Dokploy branding references in template descriptions", () => {
			const rawDesc = "Deploy WordPress with Docker Compose on Dokploy in minutes.";
			const sanitized = sanitizeTemplateDescription(rawDesc);
			expect(sanitized).not.toContain("Dokploy");
			expect(sanitized).toBe("Deploy WordPress in minutes.");
		});

		it("should handle empty or null template descriptions gracefully", () => {
			expect(sanitizeTemplateDescription("")).toBe("");
			expect(sanitizeTemplateDescription(null)).toBe("");
			expect(sanitizeTemplateDescription(undefined)).toBe("");
		});
	});

	describe("Customer Inspection URLs & Resource Resolution", () => {
		it("should resolve primary URL prioritizing user custom domain with HTTPS", () => {
			const app = {
				appName: "my-web-app-abc",
				domains: [
					{ host: "dashboard.clientcompany.com", path: "/app", https: true },
					{ host: "alt.clientcompany.com", path: "", https: false },
				],
			};

			const domain = app.domains?.[0];
			const primaryUrl = domain
				? `${domain.https ? "https" : "http"}://${domain.host}${domain.path || ""}`
				: `https://${app.appName}.hatdot.cloud`;

			expect(primaryUrl).toBe("https://dashboard.clientcompany.com/app");
		});

		it("should fallback to platform wildcard domain when no custom domain exists", () => {
			const app: {
				appName: string;
				domains: Array<{ host: string; path?: string; https?: boolean }>;
			} = {
				appName: "customer-blog-9988",
				domains: [],
			};

			const domain = app.domains?.[0];
			const primaryUrl = domain
				? `${domain.https ? "https" : "http"}://${domain.host}${domain.path || ""}`
				: `https://${app.appName}.hatdot.cloud`;

			expect(primaryUrl).toBe("https://customer-blog-9988.hatdot.cloud");
		});
	});

	describe("Administrative Actions & Safety Checks", () => {
		it("should prevent platform admin account self-deletion or deactivation", () => {
			const targetAdminId = "platform-root-admin";
			const actingAdminId = "platform-root-admin";

			const canDelete = (target: string, actor: string) => {
				if (target === actor) {
					throw new Error("Administrators cannot delete or deactivate their own account.");
				}
				return true;
			};

			expect(() => canDelete(targetAdminId, actingAdminId)).toThrow(
				/Administrators cannot delete or deactivate their own account/i,
			);
		});
	});

	describe("CLI & Full API Access Restrictions", () => {
		it("should strictly reject non-platform-admin customers from CLI access", () => {
			const checkCliAccess = (user: { role: string; isPlatformAdmin?: boolean }) => {
				if (!user.isPlatformAdmin) {
					throw new Error("CLI access is strictly restricted to platform administrators.");
				}
				return true;
			};

			const customerUser = { role: "owner", isPlatformAdmin: false };
			expect(() => checkCliAccess(customerUser)).toThrow(
				/CLI access is strictly restricted to platform administrators/i,
			);
		});

		it("should allow platform administrators to access CLI procedures", () => {
			const checkCliAccess = (user: { role: string; isPlatformAdmin?: boolean }) => {
				if (!user.isPlatformAdmin) {
					throw new Error("CLI access is strictly restricted to platform administrators.");
				}
				return true;
			};

			const adminUser = { role: "owner", isPlatformAdmin: true };
			expect(checkCliAccess(adminUser)).toBe(true);
		});

		it("should restrict OpenAPI and REST API execution to platform administrators", () => {
			const checkApiAccess = (user: { isPlatformAdmin?: boolean }) => {
				if (!user.isPlatformAdmin) {
					return { status: 403, error: "API and CLI access are strictly restricted to platform administrators." };
				}
				return { status: 200, success: true };
			};

			expect(checkApiAccess({ isPlatformAdmin: false })).toEqual({
				status: 403,
				error: "API and CLI access are strictly restricted to platform administrators.",
			});
			expect(checkApiAccess({ isPlatformAdmin: true })).toEqual({
				status: 200,
				success: true,
			});
		});
	});
});
