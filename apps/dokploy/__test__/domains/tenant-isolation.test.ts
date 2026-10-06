import { describe, expect, it, vi } from "vitest";
import {
	checkDomainTenantConflict,
	getDnsInstructionsForDomain,
} from "@dokploy/server/services/domain";

describe("Domain Tenant Isolation & Conflict Prevention", () => {
	it("should reject domain creation when domain is already registered to another organization", async () => {
		const mockTx: any = {
			query: {
				domains: {
					findMany: vi.fn(async () => [
						{
							domainId: "dom-1",
							host: "app.customer-company.com",
							application: {
								environment: {
									project: {
										organizationId: "org-tenant-a",
									},
								},
							},
						},
					]),
				},
			},
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
		const mockTx: any = {
			query: {
				domains: {
					findMany: vi.fn(async () => [
						{
							domainId: "dom-1",
							host: "app.customer-company.com",
							application: {
								environment: {
									project: {
										organizationId: "org-tenant-a",
									},
								},
							},
						},
					]),
				},
			},
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
});
