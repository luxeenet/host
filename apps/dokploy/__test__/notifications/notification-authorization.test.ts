import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization tests for the platform notification configuration API.
 *
 * These tests run the REAL `notificationRouter` (real tRPC middlewares, real
 * `platformAdminProcedure`) through `createCaller`. Only the persistence /
 * outbound-network edges are replaced by spies so we can assert that a rejected
 * caller never reaches them.
 */

const { serviceSpies, senderSpies, dbState } = vi.hoisted(() => ({
	serviceSpies: {} as Record<string, ReturnType<typeof vi.fn>>,
	senderSpies: {} as Record<string, ReturnType<typeof vi.fn>>,
	dbState: {
		findMany: undefined as unknown as ReturnType<typeof vi.fn>,
	},
}));

vi.mock("@dokploy/server/services/notification", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@dokploy/server/services/notification")
		>();
	const mocked: Record<string, unknown> = { ...original };
	for (const name of Object.keys(original)) {
		if (/^(create|update)\w+Notification$/.test(name)) {
			serviceSpies[name] = vi.fn(async () => ({}));
			mocked[name] = serviceSpies[name];
		}
	}
	serviceSpies.findNotificationById = vi.fn();
	serviceSpies.removeNotificationById = vi.fn(async () => ({}));
	mocked.findNotificationById = serviceSpies.findNotificationById;
	mocked.removeNotificationById = serviceSpies.removeNotificationById;
	return mocked;
});

vi.mock("@dokploy/server/utils/notifications/utils", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@dokploy/server/utils/notifications/utils")
		>();
	const mocked: Record<string, unknown> = { ...original };
	for (const name of Object.keys(original)) {
		if (/^send\w+Notification$/.test(name)) {
			senderSpies[name] = vi.fn(async () => undefined);
			mocked[name] = senderSpies[name];
		}
	}
	return mocked;
});

vi.mock("@dokploy/server/db", () => {
	dbState.findMany = vi.fn(async () => []);
	return {
		db: {
			query: new Proxy(
				{},
				{
					get: () => ({
						findMany: dbState.findMany,
						findFirst: vi.fn(async () => undefined),
					}),
				},
			),
		},
		dbUrl: "postgres://mock:mock@localhost:5432/mock",
	};
});

vi.mock("@dokploy/server/services/permission", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@dokploy/server/services/permission")
		>();
	// Org-level permission model: owners/admins hold `member.create`; plain
	// members do not. Used only by the invite-dialog helper.
	return {
		...original,
		checkPermission: vi.fn(async (ctx: any) => {
			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { TRPCError } = await import("@trpc/server");
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}
		}),
	};
});

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

const { notificationRouter } = await import(
	"@/server/api/routers/notification"
);
const { sendBuildSuccessNotifications } = await import(
	"@dokploy/server/utils/notifications/build-success"
);

const ORG_A = "org-customer-a";
const ORG_B = "org-customer-b";
const ORG_PLATFORM = "org-platform";

const makeCtx = (user: {
	id: string;
	role: "owner" | "admin" | "member";
	isPlatformAdmin: boolean;
	org: string;
}) =>
	({
		req: {} as any,
		res: {} as any,
		db: {} as any,
		user: {
			id: user.id,
			email: `${user.id}@example.com`,
			role: user.role,
			ownerId: user.id,
			isPlatformAdmin: user.isPlatformAdmin,
		},
		session: { activeOrganizationId: user.org },
	}) as any;

const platformAdmin = () =>
	notificationRouter.createCaller(
		makeCtx({
			id: "root",
			role: "owner",
			isPlatformAdmin: true,
			org: ORG_PLATFORM,
		}),
	);
const customerOwnerA = () =>
	notificationRouter.createCaller(
		makeCtx({
			id: "cust-a",
			role: "owner",
			isPlatformAdmin: false,
			org: ORG_A,
		}),
	);
const customerAdminA = () =>
	notificationRouter.createCaller(
		makeCtx({
			id: "cust-a-admin",
			role: "admin",
			isPlatformAdmin: false,
			org: ORG_A,
		}),
	);
const customerMemberA = () =>
	notificationRouter.createCaller(
		makeCtx({
			id: "cust-a-member",
			role: "member",
			isPlatformAdmin: false,
			org: ORG_A,
		}),
	);

/** Procedures that are intentionally NOT platform-admin-only. */
const NON_ADMIN_PROCEDURES = new Set([
	// Token-authenticated webhook used by the monitoring agent (delivery path).
	"receiveNotification",
	// Credential-free, org-scoped helper for the "invite member" dialog.
	"getEmailProviders",
]);

const allProcedureNames = Object.keys(
	(notificationRouter as any)._def.procedures,
);
const configProcedureNames = allProcedureNames.filter(
	(name) => !NON_ADMIN_PROCEDURES.has(name),
);

const dialect = new PgDialect();
const paramsOf = (where: any) => dialect.sqlToQuery(where).params;

const slackRow = (organizationId: string) => ({
	notificationId: `n-${organizationId}`,
	name: `slack-${organizationId}`,
	organizationId,
	notificationType: "slack",
	appDeploy: true,
	slack: {
		slackId: "s1",
		webhookUrl: `https://hooks.example/${organizationId}`,
		channel: "#deploys",
	},
	email: null,
	resend: null,
	discord: null,
	telegram: null,
	gotify: null,
	ntfy: null,
	mattermost: null,
	custom: null,
	lark: null,
	pushover: null,
	teams: null,
});

const emailRow = (organizationId: string) => ({
	...slackRow(organizationId),
	notificationId: `email-${organizationId}`,
	name: `smtp-${organizationId}`,
	notificationType: "email",
	slack: null,
	email: {
		emailId: "e1",
		smtpServer: "smtp.example.com",
		smtpPort: 587,
		username: "mailer",
		password: "super-secret-password",
		fromAddress: "noreply@example.com",
		toAddresses: ["x@example.com"],
	},
});

beforeEach(() => {
	for (const spy of [
		...Object.values(serviceSpies),
		...Object.values(senderSpies),
		dbState.findMany,
	]) {
		spy.mockClear();
	}
	dbState.findMany.mockImplementation(async () => []);
});

describe("notification router — procedure inventory", () => {
	it("discovers the configuration procedures dynamically (guards against vacuous loops)", () => {
		expect(configProcedureNames.length).toBeGreaterThanOrEqual(39);
		expect(configProcedureNames).toEqual(
			expect.arrayContaining([
				"all",
				"one",
				"remove",
				"createSlack",
				"updateSlack",
				"testSlackConnection",
				"createEmail",
				"testEmailConnection",
				"createCustom",
				"createTeams",
			]),
		);
		// Only the two documented exceptions may bypass platform-admin.
		expect(
			allProcedureNames.filter((n) => NON_ADMIN_PROCEDURES.has(n)).sort(),
		).toEqual([...NON_ADMIN_PROCEDURES].sort());
	});
});

describe("platform admin", () => {
	it("1. can read notification configuration (all / one)", async () => {
		serviceSpies.findNotificationById!.mockResolvedValue(slackRow(ORG_A));
		dbState.findMany.mockResolvedValue([slackRow(ORG_PLATFORM)]);

		const list = await platformAdmin().all();
		expect(list).toHaveLength(1);
		expect(paramsOf(dbState.findMany.mock.calls[0]![0].where)).toEqual([
			ORG_PLATFORM,
		]);

		// can inspect another organization's rows explicitly
		await platformAdmin().all({ organizationId: ORG_A });
		expect(paramsOf(dbState.findMany.mock.calls[1]![0].where)).toEqual([ORG_A]);

		const one = await platformAdmin().one({ notificationId: `n-${ORG_A}` });
		expect(one.organizationId).toBe(ORG_A);
	});

	it("2. can create, update (without re-homing the row) and delete", async () => {
		await platformAdmin().createSlack({
			name: "platform-slack",
			appDeploy: true,
			appBuildError: true,
			databaseBackup: true,
			volumeBackup: true,
			dokployBackup: true,
			dokployRestart: true,
			dockerCleanup: true,
			serverThreshold: false,
			webhookUrl: "https://hooks.example/x",
			channel: "#ops",
		} as any);
		expect(serviceSpies.createSlackNotification).toHaveBeenCalledTimes(1);
		expect(serviceSpies.createSlackNotification!.mock.calls[0]![1]).toBe(
			ORG_PLATFORM,
		);

		// Updating a customer-org row keeps it in the customer org.
		serviceSpies.findNotificationById!.mockResolvedValue(slackRow(ORG_A));
		await platformAdmin().updateSlack({
			notificationId: `n-${ORG_A}`,
			slackId: "s1",
			name: "renamed",
			appDeploy: true,
			appBuildError: true,
			databaseBackup: true,
			volumeBackup: true,
			dokployBackup: true,
			dokployRestart: true,
			dockerCleanup: true,
			serverThreshold: false,
			webhookUrl: "https://hooks.example/x",
			channel: "#ops",
			organizationId: ORG_PLATFORM,
		} as any);
		expect(serviceSpies.updateSlackNotification).toHaveBeenCalledTimes(1);
		expect(
			serviceSpies.updateSlackNotification!.mock.calls[0]![0].organizationId,
		).toBe(ORG_A);

		await platformAdmin().remove({ notificationId: `n-${ORG_A}` });
		expect(serviceSpies.removeNotificationById).toHaveBeenCalledWith(
			`n-${ORG_A}`,
		);
	});

	it("can run the test-send endpoints", async () => {
		await platformAdmin().testSlackConnection({
			webhookUrl: "https://hooks.example/x",
			channel: "#ops",
		} as any);
		expect(senderSpies.sendSlackNotification).toHaveBeenCalledTimes(1);
	});
});

describe("customers (org owner / admin / member, not platform admin)", () => {
	const callers = [
		["org owner", customerOwnerA],
		["org admin", customerAdminA],
		["org member", customerMemberA],
	] as const;

	it("3. cannot read platform notification configuration", async () => {
		for (const [, caller] of callers) {
			await expect(caller().all()).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(
				caller().one({ notificationId: `n-${ORG_A}` }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
		expect(dbState.findMany).not.toHaveBeenCalled();
		expect(serviceSpies.findNotificationById).not.toHaveBeenCalled();
	});

	it("4/5/6/7. cannot call ANY configuration procedure (create/update/delete/test-send)", async () => {
		for (const [label, caller] of callers) {
			for (const name of configProcedureNames) {
				await expect(
					(caller() as any)[name]({}),
					`${label} must be forbidden from notification.${name}`,
				).rejects.toMatchObject({ code: "FORBIDDEN" });
			}
		}
		for (const spy of [
			...Object.values(serviceSpies),
			...Object.values(senderSpies),
		]) {
			expect(spy).not.toHaveBeenCalled();
		}
	});

	it("cannot bypass the guard by passing a valid-looking payload", async () => {
		await expect(
			customerOwnerA().createSlack({
				name: "evil",
				appDeploy: true,
				appBuildError: true,
				databaseBackup: true,
				volumeBackup: true,
				dokployBackup: true,
				dokployRestart: true,
				dockerCleanup: true,
				serverThreshold: false,
				webhookUrl: "https://attacker.example/hook",
				channel: "#x",
			} as any),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(serviceSpies.createSlackNotification).not.toHaveBeenCalled();

		await expect(
			customerOwnerA().testSlackConnection({
				webhookUrl: "http://169.254.169.254/",
				channel: "#x",
			} as any),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(senderSpies.sendSlackNotification).not.toHaveBeenCalled();
	});

	it("unauthenticated callers are rejected", async () => {
		const anon = notificationRouter.createCaller({
			req: {} as any,
			res: {} as any,
			db: {} as any,
			user: null,
			session: null,
		} as any);
		await expect(anon.all()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(anon.remove({ notificationId: "x" })).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});

describe("customer notification access stays tenant-isolated", () => {
	it("9. getEmailProviders only queries the caller's organization and never returns credentials", async () => {
		dbState.findMany.mockResolvedValue([
			emailRow(ORG_A),
			slackRow(ORG_A), // not an email provider -> filtered out
		]);

		const result = await customerOwnerA().getEmailProviders();

		expect(paramsOf(dbState.findMany.mock.calls[0]![0].where)).toEqual([ORG_A]);
		expect(result).toEqual([
			{
				notificationId: `email-${ORG_A}`,
				name: `smtp-${ORG_A}`,
				notificationType: "email",
			},
		]);
		expect(JSON.stringify(result)).not.toContain("super-secret-password");
		expect(JSON.stringify(result)).not.toContain("smtp.example.com");
	});

	it("getEmailProviders is not available to plain members (no member.create)", async () => {
		await expect(customerMemberA().getEmailProviders()).rejects.toBeDefined();
		expect(dbState.findMany).not.toHaveBeenCalled();
	});
});

describe("notification delivery is unaffected by the configuration lock-down", () => {
	const deliveryProps = (organizationId: string) => ({
		projectName: "proj",
		applicationName: "app",
		applicationType: "application",
		buildLink: "https://panel.example/logs",
		organizationId,
		domains: [],
		environmentName: "production",
	});

	it("8. a customer organization still receives its own deployment notifications", async () => {
		dbState.findMany.mockResolvedValue([slackRow(ORG_A)]);

		await sendBuildSuccessNotifications(deliveryProps(ORG_A) as any);

		const params = paramsOf(dbState.findMany.mock.calls[0]![0].where);
		expect(params).toContain(ORG_A);
		expect(params).not.toContain(ORG_B);
		expect(senderSpies.sendSlackNotification).toHaveBeenCalledTimes(1);
		expect(senderSpies.sendSlackNotification!.mock.calls[0]![0]).toMatchObject({
			webhookUrl: `https://hooks.example/${ORG_A}`,
		});
	});

	it("9. delivery for customer A never selects customer B's destinations", async () => {
		dbState.findMany.mockImplementation(async (args: any) => {
			const params = paramsOf(args.where);
			return [slackRow(ORG_A), slackRow(ORG_B)].filter((row) =>
				params.includes(row.organizationId),
			);
		});

		await sendBuildSuccessNotifications(deliveryProps(ORG_A) as any);

		expect(senderSpies.sendSlackNotification).toHaveBeenCalledTimes(1);
		expect(senderSpies.sendSlackNotification!.mock.calls[0]![0]).toMatchObject({
			webhookUrl: `https://hooks.example/${ORG_A}`,
		});
	});

	it("10. delivery path does not depend on any tRPC authorization", async () => {
		// Called with no session/user at all (as the deployment worker does).
		dbState.findMany.mockResolvedValue([slackRow(ORG_PLATFORM)]);
		await expect(
			sendBuildSuccessNotifications(deliveryProps(ORG_PLATFORM) as any),
		).resolves.toBeUndefined();
		expect(senderSpies.sendSlackNotification).toHaveBeenCalledTimes(1);
	});
});
