import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock docker & service functions
const mockStopService = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStartService = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStopCompose = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockStartCompose = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockRemoveService = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRemoveCompose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDeleteProject = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockRemoveTraefikConfig = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRemoveDirectoryCode = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("@dokploy/server/utils/docker/utils", () => ({
	stopService: mockStopService,
	stopServiceRemote: mockStopService,
	startService: mockStartService,
	startServiceRemote: mockStartService,
	removeService: mockRemoveService,
}));

vi.mock("@dokploy/server/services/compose", () => ({
	stopCompose: mockStopCompose,
	startCompose: mockStartCompose,
	removeCompose: mockRemoveCompose,
}));

vi.mock("@dokploy/server/services/project", () => ({
	deleteProject: mockDeleteProject,
}));

vi.mock("@dokploy/server/utils/traefik/application", () => ({
	removeTraefikConfig: mockRemoveTraefikConfig,
}));

vi.mock("@dokploy/server/utils/filesystem/directory", () => ({
	removeDirectoryCode: mockRemoveDirectoryCode,
}));

vi.mock("@dokploy/server/verification/send-verification-email", () => ({
	sendEmail: mockSendEmail,
}));

// Mock DB queries & updates
const mockSubscriptionsFindMany = vi.hoisted(() => vi.fn());
const mockSubscriptionsFindFirst = vi.hoisted(() => vi.fn());
const mockInvoicesFindFirst = vi.hoisted(() => vi.fn());
const mockPlansFindFirst = vi.hoisted(() => vi.fn());
const mockPlatformSettingsFindFirst = vi.hoisted(() => vi.fn());
const mockMemberFindFirst = vi.hoisted(() => vi.fn());
const mockProjectsFindMany = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbInsert = vi.hoisted(() => vi.fn());

vi.mock("@dokploy/server/db", () => {
	const chain = {
		set: vi.fn().mockReturnThis(),
		where: vi.fn().mockResolvedValue([{}]),
		values: vi.fn().mockResolvedValue([{}]),
	};
	mockDbUpdate.mockReturnValue(chain);
	mockDbInsert.mockReturnValue(chain);

	return {
		db: {
			query: {
				subscriptions: {
					findMany: mockSubscriptionsFindMany,
					findFirst: mockSubscriptionsFindFirst,
				},
				invoices: {
					findFirst: mockInvoicesFindFirst,
				},
				plans: {
					findFirst: mockPlansFindFirst,
				},
				platformSettings: {
					findFirst: mockPlatformSettingsFindFirst,
				},
				member: {
					findFirst: mockMemberFindFirst,
				},
				projects: {
					findMany: mockProjectsFindMany,
				},
			},
			update: mockDbUpdate,
			insert: mockDbInsert,
			$count: vi.fn().mockResolvedValue(10),
		},
	};
});

import {
	applyGracePeriod,
	suspendExpiredGracePeriods,
	deprovisionExpiredOrganizations,
	stopOrganizationServices,
	startOrganizationServices,
	activateSubscriptionOnPayment,
	sendBillingNotification,
} from "@dokploy/server/services/billing-cycle";

describe("HatDot Billing Lifecycle & Overdue Service Suspension", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPlatformSettingsFindFirst.mockResolvedValue(null); // default fallback
		mockMemberFindFirst.mockResolvedValue({
			role: "owner",
			user: { email: "customer@company.com", firstName: "Alice", lastName: "Smith" },
			organization: { name: "Acme Corp" },
		});
	});

	describe("1. Grace Period Handling", () => {
		it("transitions overdue subscriptions to grace_period and sends warning email", async () => {
			const pastDueInvoice = {
				id: "inv-1",
				dueDate: new Date(Date.now() - 4 * 86400000), // 4 days ago
				amount: "25000",
				currency: "TZS",
			};

			mockSubscriptionsFindMany.mockResolvedValueOnce([
				{ id: "sub-1", organizationId: "org-1", status: "past_due" },
			]);
			mockInvoicesFindFirst.mockResolvedValueOnce(pastDueInvoice);

			const count = await applyGracePeriod();

			expect(count).toBe(1);
			expect(mockDbUpdate).toHaveBeenCalled();
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "customer@company.com",
					subject: expect.stringContaining("Payment Past Due"),
				}),
			);
		});
	});

	describe("2. Service Suspension upon Grace Period Expiry", () => {
		it("stops customer applications, databases, and compose stacks when grace period expires", async () => {
			mockSubscriptionsFindMany.mockResolvedValueOnce([
				{ id: "sub-1", organizationId: "org-1", status: "grace_period", gracePeriodEndsAt: new Date(Date.now() - 1000) },
			]);

			mockProjectsFindMany.mockResolvedValue([
				{
					projectId: "proj-1",
					environments: [
						{
							applications: [{ appName: "web-app-1", serverId: null }],
							postgres: [{ appName: "pg-db-1", serverId: null }],
							mariadb: [],
							mysql: [],
							mongo: [],
							redis: [],
							libsql: [],
							compose: [{ composeId: "comp-1", appName: "stack-1" }],
						},
					],
				},
			]);

			const suspendedCount = await suspendExpiredGracePeriods();

			expect(suspendedCount).toBe(1);
			// Verify containers were stopped
			expect(mockStopService).toHaveBeenCalledWith("web-app-1");
			expect(mockStopService).toHaveBeenCalledWith("pg-db-1");
			expect(mockStopCompose).toHaveBeenCalledWith("comp-1");

			// Verify suspension email was dispatched
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "customer@company.com",
					subject: expect.stringContaining("Services Suspended"),
				}),
			);
		});
	});

	describe("3. Auto-Reactivation upon Payment", () => {
		it("restarts all stopped services and sends confirmation email when customer pays", async () => {
			mockSubscriptionsFindFirst.mockResolvedValueOnce({
				id: "sub-1",
				organizationId: "org-1",
				status: "suspended",
				suspendedAt: new Date(Date.now() - 86400000),
				plan: { billingCycle: "monthly" },
			});

			mockProjectsFindMany.mockResolvedValue([
				{
					projectId: "proj-1",
					environments: [
						{
							applications: [{ appName: "web-app-1", serverId: null }],
							postgres: [{ appName: "pg-db-1", serverId: null }],
							mariadb: [],
							mysql: [],
							mongo: [],
							redis: [],
							libsql: [],
							compose: [{ composeId: "comp-1", appName: "stack-1" }],
						},
					],
				},
			]);

			await activateSubscriptionOnPayment("sub-1");

			// Verify containers were restarted
			expect(mockStartService).toHaveBeenCalledWith("web-app-1");
			expect(mockStartService).toHaveBeenCalledWith("pg-db-1");
			expect(mockStartCompose).toHaveBeenCalledWith("comp-1");

			// Verify confirmation email was dispatched
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "customer@company.com",
					subject: expect.stringContaining("Services Reactivated"),
				}),
			);
		});
	});

	describe("4. Retention & Deprovisioning Lifecycle", () => {
		it("sends final deletion warning when approaching retention cutoff", async () => {
			// Suspended 12 days ago (retention is 14 days, warning cutoff is 11 days ago)
			mockSubscriptionsFindMany.mockResolvedValueOnce([
				{
					id: "sub-warning",
					organizationId: "org-warning",
					status: "suspended",
					suspendedAt: new Date(Date.now() - 12 * 86400000),
					metadata: {},
				},
			]);

			const deprovisioned = await deprovisionExpiredOrganizations();

			expect(deprovisioned).toBe(0);
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "customer@company.com",
					subject: expect.stringContaining("FINAL NOTICE"),
				}),
			);
		});

		it("permanently deprovisions services and deletes projects after retention period exceeds", async () => {
			// Suspended 20 days ago (exceeds 14-day retention)
			mockSubscriptionsFindMany.mockResolvedValueOnce([
				{
					id: "sub-expired",
					organizationId: "org-expired",
					status: "suspended",
					suspendedAt: new Date(Date.now() - 20 * 86400000),
				},
			]);

			mockProjectsFindMany.mockResolvedValue([
				{
					projectId: "proj-old",
					environments: [
						{
							applications: [{ appName: "dead-app", serverId: null }],
							postgres: [],
							mariadb: [],
							mysql: [],
							mongo: [],
							redis: [],
							libsql: [],
							compose: [],
						},
					],
				},
			]);

			const deprovisioned = await deprovisionExpiredOrganizations();

			expect(deprovisioned).toBe(1);
			expect(mockRemoveService).toHaveBeenCalledWith("dead-app", null);
			expect(mockDeleteProject).toHaveBeenCalledWith("proj-old");
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "customer@company.com",
					subject: expect.stringContaining("Services Decommissioned"),
				}),
			);
		});
	});
});
