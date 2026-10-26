import { describe, expect, it, vi } from "vitest";
import { setPrimaryDomain } from "@dokploy/server/services/domain";

describe("Domain Primary and Management", () => {
	it("should set primary domain for an application and reset other domains of the application", async () => {
		const updates: any[] = [];
		const mockDomain = {
			domainId: "dom-target",
			applicationId: "app-123",
			composeId: null,
			host: "primary.example.com",
			isPrimary: false,
		};

		const mockTx: any = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([mockDomain]),
					})),
				})),
			})),
			update: vi.fn(() => ({
				set: vi.fn((setData) => ({
					where: vi.fn((whereClause) => {
						updates.push({ setData, whereClause });
						return Promise.resolve();
					}),
				})),
			})),
		};

		const result = await setPrimaryDomain("dom-target", mockTx);

		expect(mockTx.update).toHaveBeenCalled();
		expect(updates.length).toBe(2);
		// First update unsets isPrimary for other domains of app-123
		expect(updates[0].setData).toEqual({ isPrimary: false });
		// Second update sets isPrimary to true for dom-target
		expect(updates[1].setData).toEqual({ isPrimary: true });
		expect(result.domainId).toBe("dom-target");
	});

	it("should set primary domain for a compose service and reset other domains of the compose service", async () => {
		const updates: any[] = [];
		const mockComposeDomain = {
			domainId: "dom-compose-2",
			applicationId: null,
			composeId: "comp-456",
			host: "compose-primary.example.com",
			isPrimary: false,
		};

		const mockTx: any = {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([mockComposeDomain]),
					})),
				})),
			})),
			update: vi.fn(() => ({
				set: vi.fn((setData) => ({
					where: vi.fn((whereClause) => {
						updates.push({ setData, whereClause });
						return Promise.resolve();
					}),
				})),
			})),
		};

		const result = await setPrimaryDomain("dom-compose-2", mockTx);

		expect(updates.length).toBe(2);
		expect(updates[0].setData).toEqual({ isPrimary: false });
		expect(updates[1].setData).toEqual({ isPrimary: true });
		expect(result.domainId).toBe("dom-compose-2");
	});
});
