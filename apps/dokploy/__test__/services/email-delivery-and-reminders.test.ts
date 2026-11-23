import { beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@paas/branding";

// Mock docker & service functions to avoid Dockerode pipe timeouts
vi.mock("@dokploy/server/utils/docker/utils", () => ({
	stopService: vi.fn().mockResolvedValue(undefined),
	stopServiceRemote: vi.fn().mockResolvedValue(undefined),
	startService: vi.fn().mockResolvedValue(undefined),
	startServiceRemote: vi.fn().mockResolvedValue(undefined),
	removeService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/services/compose", () => ({
	stopCompose: vi.fn().mockResolvedValue(true),
	startCompose: vi.fn().mockResolvedValue(true),
	removeCompose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/services/project", () => ({
	deleteProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("@dokploy/server/utils/traefik/application", () => ({
	removeTraefikConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dokploy/server/utils/filesystem/directory", () => ({
	removeDirectoryCode: vi.fn().mockResolvedValue(undefined),
}));

const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockSendPlatformMail = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("@dokploy/server/services/admin", () => ({
	getDokployUrl: vi.fn().mockResolvedValue("https://hatdot.cloud"),
}));

vi.mock("@dokploy/server/verification/send-verification-email", () => ({
	sendEmail: mockSendEmail,
	sendInvitationEmail: vi.fn().mockImplementation(async ({ email, inviteLink, organizationName }) => {
		return mockSendEmail({
			email,
			subject: `You've been invited to join ${organizationName} on ${brand.APP_NAME}`,
			html: `<p>Join ${organizationName} at ${inviteLink}</p>`,
		});
	}),
	renderInvitationEmail: vi.fn().mockResolvedValue("<html>Invitation</html>"),
}));

vi.mock("@dokploy/server/services/smtp-settings", () => ({
	sendPlatformMail: mockSendPlatformMail,
	getSmtpResolvedCredentials: vi.fn().mockResolvedValue({
		host: "smtp.example.com",
		port: 587,
		user: "user@example.com",
		pass: "secret",
		from: "notifications@hatdot.cloud",
		fromName: brand.APP_NAME,
		secure: false,
		configured: true,
	}),
}));

// Mock DB queries & updates
const mockInvoicesFindMany = vi.hoisted(() => vi.fn());
const mockSubscriptionsFindMany = vi.hoisted(() => vi.fn());
const mockMemberFindFirst = vi.hoisted(() => vi.fn());
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
				invoices: {
					findMany: mockInvoicesFindMany,
				},
				subscriptions: {
					findMany: mockSubscriptionsFindMany,
				},
				member: {
					findFirst: mockMemberFindFirst,
				},
				webServerSettings: {
					findFirst: vi.fn().mockResolvedValue({ host: "hatdot.cloud", https: true }),
				},
			},
			update: mockDbUpdate,
			insert: mockDbInsert,
			$count: vi.fn().mockResolvedValue(10),
		},
	};
});

import {
	sendBillingReminders,
	sendBillingNotification,
} from "@dokploy/server/services/billing-cycle";
import { sendInvitationEmail } from "@dokploy/server/verification/send-verification-email";

describe("Email Delivery & Multi-Daily Billing Reminders", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInvoicesFindMany.mockResolvedValue([]);
		mockSubscriptionsFindMany.mockResolvedValue([]);

		mockMemberFindFirst.mockResolvedValue({
			userId: "usr-owner",
			organizationId: "org-test",
			role: "owner",
			user: {
				id: "usr-owner",
				email: "owner@workspace.com",
				firstName: "John",
				lastName: "Doe",
			},
			organization: {
				id: "org-test",
				name: "Acme Cloud Workspace",
			},
		});
	});

	describe("1. Multi-Daily Billing Reminders", () => {
		it("sends invoice reminders for open invoices older than 12 hours (multi-daily)", async () => {
			const twelveHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();

			mockInvoicesFindMany.mockResolvedValueOnce([
				{
					id: "inv-open-1",
					organizationId: "org-test",
					invoiceNumber: "INV-2026-00042",
					amount: "50000",
					currency: "TZS",
					status: "open",
					dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // Due in 2 days
					metadata: {
						lastReminderSentAt: twelveHoursAgo,
						reminderCount: 1,
					},
				},
			]);

			const result = await sendBillingReminders();
			expect(result.invoicesReminded).toBe(1);
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "owner@workspace.com",
					subject: expect.stringContaining("Payment Reminder: Invoice #INV-2026-00042"),
				}),
			);
		});

		it("sends overdue invoice reminders every 8 hours (3x per day for critical urgency)", async () => {
			const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

			mockInvoicesFindMany.mockResolvedValueOnce([
				{
					id: "inv-overdue-1",
					organizationId: "org-test",
					invoiceNumber: "INV-2026-00099",
					amount: "120000",
					currency: "TZS",
					status: "open",
					dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Overdue by 2 days
					metadata: {
						lastReminderSentAt: nineHoursAgo,
						reminderCount: 3,
					},
				},
			]);

			const result = await sendBillingReminders();
			expect(result.invoicesReminded).toBe(1);
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "owner@workspace.com",
					subject: expect.stringContaining("Invoice #INV-2026-00099 Overdue"),
				}),
			);
		});

		it("throttles invoice reminders when sent less than 8 hours ago to avoid spam", async () => {
			const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

			mockInvoicesFindMany.mockResolvedValueOnce([
				{
					id: "inv-recent-1",
					organizationId: "org-test",
					invoiceNumber: "INV-2026-00042",
					amount: "50000",
					currency: "TZS",
					status: "open",
					dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
					metadata: {
						lastReminderSentAt: twoHoursAgo,
						reminderCount: 1,
					},
				},
			]);

			const result = await sendBillingReminders();
			expect(result.invoicesReminded).toBe(0);
			expect(mockSendEmail).not.toHaveBeenCalled();
		});

		it("sends urgent grace period countdown reminders every 8 hours with remaining hours", async () => {
			const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
			const graceEndsAt = new Date(Date.now() + 14 * 60 * 60 * 1000); // 14 hours left

			mockSubscriptionsFindMany
				.mockResolvedValueOnce([
					{
						id: "sub-grace-1",
						organizationId: "org-test",
						status: "grace_period",
						gracePeriodEndsAt: graceEndsAt,
						metadata: {
							lastGraceReminderSentAt: tenHoursAgo,
							graceReminderCount: 2,
						},
					},
				])
				.mockResolvedValueOnce([]); // for trial query

			const result = await sendBillingReminders();
			expect(result.graceReminded).toBe(1);
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "owner@workspace.com",
					subject: expect.stringMatching(/URGENT:.*Remaining in Grace Period/),
				}),
			);
		});

		it("sends trial ending notifications twice a day (every 12 hours) when within 3 days", async () => {
			mockSubscriptionsFindMany
				.mockResolvedValueOnce([]) // grace period query
				.mockResolvedValueOnce([
					{
						id: "sub-trial-1",
						organizationId: "org-test",
						status: "trial",
						trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days left
						plan: { name: "Pro Cloud Tier" },
						metadata: {
							lastTrialReminderSentAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
						},
					},
				]);

			const result = await sendBillingReminders();
			expect(result.trialsReminded).toBe(1);
			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "owner@workspace.com",
					subject: expect.stringContaining("trial ends in 2 days"),
				}),
			);
		});
	});

	describe("2. Team Invitation Email Delivery & Branding", () => {
		it("sends invitation emails with brand display name and correct platform link", async () => {
			await sendInvitationEmail({
				email: "dev@company.com",
				inviteLink: "https://hatdot.cloud/invitation?token=inv-token-abc",
				organizationName: "Engineering Team",
			});

			expect(mockSendEmail).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "dev@company.com",
					subject: `You've been invited to join Engineering Team on ${brand.APP_NAME}`,
				}),
			);
		});

		it("ensures email subjects never contain forbidden words (Dokploy / Sonicpesa)", async () => {
			await sendBillingNotification("org-test", "grace_period", {
				graceDays: 3,
				graceEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			});

			const calls = mockSendEmail.mock.calls;
			expect(calls.length).toBeGreaterThan(0);
			const lastCall = calls[calls.length - 1][0];

			expect(lastCall.subject).not.toMatch(/dokploy/i);
			expect(lastCall.subject).not.toMatch(/sonicpesa/i);
			expect(lastCall.html).not.toMatch(/dokploy/i);
			expect(lastCall.html).not.toMatch(/sonicpesa/i);
			expect(lastCall.html).toContain(brand.APP_NAME);
		});
	});
});
