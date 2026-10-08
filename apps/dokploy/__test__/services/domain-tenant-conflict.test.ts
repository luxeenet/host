import { describe, expect, it, vi } from "vitest";
import { checkDomainTenantConflict } from "@dokploy/server/services/domain";

/**
 * Builds a fake transaction whose successive select() chains resolve to the
 * given row sets, in the order checkDomainTenantConflict queries them:
 * application domains, compose domains, preview domains.
 */
const makeTx = (appRows: any[], composeRows: any[], previewRows: any[]) => {
	const results = [appRows, composeRows, previewRows];
	let call = 0;
	return {
		select: vi.fn(() => {
			const rows = results[call++] ?? [];
			const chain: any = {
				from: () => chain,
				innerJoin: () => chain,
				where: () => chain,
				limit: () => Promise.resolve(rows),
			};
			return chain;
		}),
	};
};

describe("checkDomainTenantConflict (domain takeover protection)", () => {
	it("allows a host nobody else uses", async () => {
		const tx = makeTx([], [], []);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).resolves.toBeUndefined();
	});

	it("allows the same organization to reuse its own host", async () => {
		const tx = makeTx(
			[{ domainId: "d1", host: "app.example.com", organizationId: "org-a" }],
			[],
			[],
		);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).resolves.toBeUndefined();
	});

	it("rejects a host owned by another organization's application", async () => {
		const tx = makeTx(
			[{ domainId: "d1", host: "app.example.com", organizationId: "org-b" }],
			[],
			[],
		);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("rejects a host owned by another organization's compose service", async () => {
		const tx = makeTx(
			[],
			[{ domainId: "d2", host: "app.example.com", organizationId: "org-b" }],
			[],
		);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("rejects a host owned by another organization's preview deployment", async () => {
		const tx = makeTx(
			[],
			[],
			[{ domainId: "d3", host: "app.example.com", organizationId: "org-b" }],
		);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("does not leak the other organization's id in the error message", async () => {
		const tx = makeTx(
			[{ domainId: "d1", host: "app.example.com", organizationId: "org-b" }],
			[],
			[],
		);
		await expect(
			checkDomainTenantConflict("app.example.com", "org-a", undefined, tx),
		).rejects.toThrow(/^(?!.*org-b)/);
	});

	it("skips the check when there is no host or target organization", async () => {
		const tx = makeTx([], [], []);
		await checkDomainTenantConflict("", "org-a", undefined, tx);
		await checkDomainTenantConflict("app.example.com", null, undefined, tx);
		expect(tx.select).not.toHaveBeenCalled();
	});
});
