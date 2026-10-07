import { describe, expect, it, vi } from "vitest";
import {
	checkDomainTenantConflict,
	getDnsInstructionsForDomain,
} from "@dokploy/server/services/domain";

describe("Domain Tenant Isolation & Conflict Prevention", () => {
	it("should reject domain creation when domain is already registered to another organization", async () => {
		const mockConflictQuery = {
			from: vi.fn().mockReturnThis(),
			innerJoin: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([
				{
					domainId: "dom-1",
					host: "app.customer-company.com",
					organizationId: "org-tenant-a",
				},
			]),
		};
		const mockTx: any = {
			select: vi.fn(() => mockConflictQuery),
		};

		// Attempting to attach app.customer-company.com in org-tenant-b should throw CONFLICT
		await expect(
			checkDomainTenantConflict(
				"app.customer-company.com",
				"org-tenant-b",
				undefined,
				mockTx,
			),
		).rejects.toThrow(/already registered to another organization/i);
	});

	it("should allow domain creation when domain belongs to the same organization", async () => {
		const mockConflictQuery = {
			from: vi.fn().mockReturnThis(),
			innerJoin: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue([]),
		};
		const mockTx: any = {
			select: vi.fn(() => mockConflictQuery),
		};

		// Same org adding another path or updating should succeed
		await expect(
			checkDomainTenantConflict(
				"app.customer-company.com",
				"org-tenant-a",
				"dom-1",
				mockTx,
			),
		).resolves.not.toThrow();
	});

	it("should parse DNS instructions correctly for apex and subdomains", async () => {
		const subInstructions = await getDnsInstructionsForDomain("api.mycompany.com");
		expect(subInstructions.recordType).toBe("A");
		expect(subInstructions.recordName).toBe("api");
		expect(subInstructions.isSubdomain).toBe(true);

		const apexInstructions = await getDnsInstructionsForDomain("mycompany.com");
		expect(apexInstructions.recordType).toBe("A");
		expect(apexInstructions.recordName).toBe("@");
		expect(apexInstructions.isSubdomain).toBe(false);
	});

	it("should never use localhost or internal container IP when public IP is available", async () => {
		const { generateRandomDomain } = await import("@dokploy/server/templates");
		const domain = generateRandomDomain({
			serverIp: "45.88.188.6",
			projectName: "butax",
		});
		expect(domain).toContain("45-88-188-6.sslip.io");
		expect(domain).not.toContain("127-0-0-1");
		expect(domain).not.toContain("localhost");
	});
});
