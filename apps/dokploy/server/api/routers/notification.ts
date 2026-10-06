import {
	createCustomNotification,
	createDiscordNotification,
	createEmailNotification,
	createGotifyNotification,
	createLarkNotification,
	createMattermostNotification,
	createNtfyNotification,
	createPushoverNotification,
	createResendNotification,
	createSlackNotification,
	createTeamsNotification,
	createTelegramNotification,
	findNotificationById,
	getWebServerSettings,
	removeNotificationById,
	sendCustomNotification,
	sendDiscordNotification,
	sendEmailNotification,
	sendGotifyNotification,
	sendLarkNotification,
	sendMattermostNotification,
	sendNtfyNotification,
	sendPushoverNotification,
	sendResendNotification,
	sendServerThresholdNotifications,
	sendSlackNotification,
	sendTeamsNotification,
	sendTelegramNotification,
	updateCustomNotification,
	updateDiscordNotification,
	updateEmailNotification,
	updateGotifyNotification,
	updateLarkNotification,
	updateMattermostNotification,
	updateNtfyNotification,
	updatePushoverNotification,
	updateResendNotification,
	updateSlackNotification,
	updateTeamsNotification,
	updateTelegramNotification,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	createTRPCRouter,
	platformAdminProcedure,
	publicProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateCustom,
	apiCreateDiscord,
	apiCreateEmail,
	apiCreateGotify,
	apiCreateLark,
	apiCreateMattermost,
	apiCreateNtfy,
	apiCreatePushover,
	apiCreateResend,
	apiCreateSlack,
	apiCreateTeams,
	apiCreateTelegram,
	apiFindOneNotification,
	apiTestCustomConnection,
	apiTestDiscordConnection,
	apiTestEmailConnection,
	apiTestGotifyConnection,
	apiTestLarkConnection,
	apiTestMattermostConnection,
	apiTestNtfyConnection,
	apiTestPushoverConnection,
	apiTestResendConnection,
	apiTestSlackConnection,
	apiTestTeamsConnection,
	apiTestTelegramConnection,
	apiUpdateCustom,
	apiUpdateDiscord,
	apiUpdateEmail,
	apiUpdateGotify,
	apiUpdateLark,
	apiUpdateMattermost,
	apiUpdateNtfy,
	apiUpdatePushover,
	apiUpdateResend,
	apiUpdateSlack,
	apiUpdateTeams,
	apiUpdateTelegram,
	notifications,
	server,
} from "@/server/db/schema";

export const notificationRouter = createTRPCRouter({
	createSlack: platformAdminProcedure
		.input(apiCreateSlack)
		.mutation(async ({ input, ctx }) => {
			try {
				await createSlackNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				console.log(error);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateSlack: platformAdminProcedure
		.input(apiUpdateSlack)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateSlackNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testSlackConnection: platformAdminProcedure
		.input(apiTestSlackConnection)
		.mutation(async ({ input }) => {
			try {
				await sendSlackNotification(input, {
					channel: input.channel,
					text: "Hi, From Dokploy 👋",
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	createTelegram: platformAdminProcedure
		.input(apiCreateTelegram)
		.mutation(async ({ input, ctx }) => {
			try {
				await createTelegramNotification(
					input,
					ctx.session.activeOrganizationId,
				);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),

	updateTelegram: platformAdminProcedure
		.input(apiUpdateTelegram)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateTelegramNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error updating the notification",
					cause: error,
				});
			}
		}),
	testTelegramConnection: platformAdminProcedure
		.input(apiTestTelegramConnection)
		.mutation(async ({ input }) => {
			try {
				await sendTelegramNotification(input, "Hi, From Dokploy 👋");
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error testing the notification",
					cause: error,
				});
			}
		}),
	createDiscord: platformAdminProcedure
		.input(apiCreateDiscord)
		.mutation(async ({ input, ctx }) => {
			try {
				await createDiscordNotification(
					input,
					ctx.session.activeOrganizationId,
				);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),

	updateDiscord: platformAdminProcedure
		.input(apiUpdateDiscord)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateDiscordNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error updating the notification",
					cause: error,
				});
			}
		}),

	testDiscordConnection: platformAdminProcedure
		.input(apiTestDiscordConnection)
		.mutation(async ({ input }) => {
			try {
				const decorate = (decoration: string, text: string) =>
					`${input.decoration ? decoration : ""} ${text}`.trim();

				await sendDiscordNotification(input, {
					title: decorate(">", "`🤚` - Test Notification"),
					description: decorate(">", "Hi, From Dokploy 👋"),
					color: 0xf3f7f4,
				});

				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	createEmail: platformAdminProcedure
		.input(apiCreateEmail)
		.mutation(async ({ input, ctx }) => {
			try {
				await createEmailNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateEmail: platformAdminProcedure
		.input(apiUpdateEmail)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateEmailNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error updating the notification",
					cause: error,
				});
			}
		}),
	testEmailConnection: platformAdminProcedure
		.input(apiTestEmailConnection)
		.mutation(async ({ input }) => {
			try {
				await sendEmailNotification(
					input,
					"Test Email",
					"<p>Hi, From Dokploy 👋</p>",
				);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	createResend: platformAdminProcedure
		.input(apiCreateResend)
		.mutation(async ({ input, ctx }) => {
			try {
				await createResendNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateResend: platformAdminProcedure
		.input(apiUpdateResend)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateResendNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error updating the notification",
					cause: error,
				});
			}
		}),
	testResendConnection: platformAdminProcedure
		.input(apiTestResendConnection)
		.mutation(async ({ input }) => {
			try {
				await sendResendNotification(
					input,
					"Test Email",
					"<p>Hi, From Dokploy 👋</p>",
				);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	remove: platformAdminProcedure
		.input(apiFindOneNotification)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				await audit(ctx, {
					action: "delete",
					resourceType: "notification",
					resourceName: notification.name,
				});
				return await removeNotificationById(input.notificationId);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Error deleting this notification";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
	one: platformAdminProcedure
		.input(apiFindOneNotification)
		.query(async ({ input }) => {
			return await findNotificationById(input.notificationId);
		}),
	all: platformAdminProcedure
		.input(
			z.object({ organizationId: z.string().min(1).optional() }).optional(),
		)
		.query(async ({ ctx, input }) => {
			return await db.query.notifications.findMany({
				with: {
					slack: true,
					telegram: true,
					discord: true,
					email: true,
					resend: true,
					gotify: true,
					ntfy: true,
					mattermost: true,
					custom: true,
					lark: true,
					pushover: true,
					teams: true,
				},
				orderBy: desc(notifications.createdAt),
				where: eq(
					notifications.organizationId,
					input?.organizationId ?? ctx.session.activeOrganizationId,
				),
			});
		}),
	receiveNotification: publicProcedure
		.input(
			z.object({
				ServerType: z.enum(["Dokploy", "Remote"]).default("Dokploy"),
				Type: z.enum(["Memory", "CPU"]),
				Value: z.number(),
				Threshold: z.number(),
				Message: z.string(),
				Timestamp: z.string(),
				Token: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				let organizationId = "";
				let ServerName = "";
				if (input.ServerType === "Dokploy") {
					const settings = await getWebServerSettings();
					if (
						!settings?.metricsConfig?.server?.token ||
						settings.metricsConfig.server.token !== input.Token
					) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Token not found",
						});
					}

					organizationId = "";
					ServerName = "Dokploy";
				} else {
					const result = await db
						.select()
						.from(server)
						.where(
							sql`${server.metricsConfig}::jsonb -> 'server' ->> 'token' = ${input.Token}`,
						);

					if (!result?.[0]?.organizationId) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Token not found",
						});
					}

					organizationId = result?.[0]?.organizationId;
					ServerName = result?.[0]?.name ?? "Remote";
				}

				await sendServerThresholdNotifications(organizationId, {
					...input,
					ServerName,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error sending the notification",
					cause: error,
				});
			}
		}),
	createGotify: platformAdminProcedure
		.input(apiCreateGotify)
		.mutation(async ({ input, ctx }) => {
			try {
				await createGotifyNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateGotify: platformAdminProcedure
		.input(apiUpdateGotify)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateGotifyNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testGotifyConnection: platformAdminProcedure
		.input(apiTestGotifyConnection)
		.mutation(async ({ input }) => {
			try {
				await sendGotifyNotification(
					input,
					"Test Notification",
					"Hi, From Dokploy 👋",
				);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error testing the notification",
					cause: error,
				});
			}
		}),
	createNtfy: platformAdminProcedure
		.input(apiCreateNtfy)
		.mutation(async ({ input, ctx }) => {
			try {
				await createNtfyNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateNtfy: platformAdminProcedure
		.input(apiUpdateNtfy)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateNtfyNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testNtfyConnection: platformAdminProcedure
		.input(apiTestNtfyConnection)
		.mutation(async ({ input }) => {
			try {
				await sendNtfyNotification(
					input,
					"Test Notification",
					"",
					"view, visit Dokploy on Github, https://github.com/dokploy/dokploy, clear=true;",
					"Hi, From Dokploy 👋",
				);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? `Error testing the notification: ${error.message}`
							: "Error testing the notification",
					cause: error,
				});
			}
		}),
	createMattermost: platformAdminProcedure
		.input(apiCreateMattermost)
		.mutation(async ({ input, ctx }) => {
			try {
				await createMattermostNotification(
					input,
					ctx.session.activeOrganizationId,
				);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateMattermost: platformAdminProcedure
		.input(apiUpdateMattermost)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateMattermostNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testMattermostConnection: platformAdminProcedure
		.input(apiTestMattermostConnection)
		.mutation(async ({ input }) => {
			try {
				await sendMattermostNotification(input, {
					text: "Hi, From Dokploy 👋",
					channel: input.channel,
					username: input.username || "Dokploy Bot",
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error testing the notification",
					cause: error,
				});
			}
		}),
	createCustom: platformAdminProcedure
		.input(apiCreateCustom)
		.mutation(async ({ input, ctx }) => {
			try {
				await createCustomNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateCustom: platformAdminProcedure
		.input(apiUpdateCustom)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateCustomNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testCustomConnection: platformAdminProcedure
		.input(apiTestCustomConnection)
		.mutation(async ({ input }) => {
			try {
				await sendCustomNotification(input, {
					title: "Test Notification",
					message: "Hi, From Dokploy 👋",
					timestamp: new Date().toISOString(),
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	createLark: platformAdminProcedure
		.input(apiCreateLark)
		.mutation(async ({ input, ctx }) => {
			try {
				await createLarkNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateLark: platformAdminProcedure
		.input(apiUpdateLark)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateLarkNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testLarkConnection: platformAdminProcedure
		.input(apiTestLarkConnection)
		.mutation(async ({ input }) => {
			try {
				await sendLarkNotification(input, {
					msg_type: "text",
					content: {
						text: "Hi, From Dokploy 👋",
					},
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error testing the notification",
					cause: error,
				});
			}
		}),
	createTeams: platformAdminProcedure
		.input(apiCreateTeams)
		.mutation(async ({ input, ctx }) => {
			try {
				await createTeamsNotification(input, ctx.session.activeOrganizationId);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updateTeams: platformAdminProcedure
		.input(apiUpdateTeams)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updateTeamsNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testTeamsConnection: platformAdminProcedure
		.input(apiTestTeamsConnection)
		.mutation(async ({ input }) => {
			try {
				await sendTeamsNotification(input, {
					title: "🤚 Test Notification",
					facts: [{ name: "Message", value: "Hi, From Dokploy 👋" }],
				});
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${error instanceof Error ? error.message : "Unknown error"}`,
					cause: error,
				});
			}
		}),
	createPushover: platformAdminProcedure
		.input(apiCreatePushover)
		.mutation(async ({ input, ctx }) => {
			try {
				await createPushoverNotification(
					input,
					ctx.session.activeOrganizationId,
				);
				await audit(ctx, {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating the notification",
					cause: error,
				});
			}
		}),
	updatePushover: platformAdminProcedure
		.input(apiUpdatePushover)
		.mutation(async ({ input, ctx }) => {
			try {
				const notification = await findNotificationById(input.notificationId);
				const result = await updatePushoverNotification({
					...input,
					organizationId: notification.organizationId,
				});
				await audit(ctx, {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
				});
				return result;
			} catch (error) {
				throw error;
			}
		}),
	testPushoverConnection: platformAdminProcedure
		.input(apiTestPushoverConnection)
		.mutation(async ({ input }) => {
			try {
				await sendPushoverNotification(
					input,
					"Test Notification",
					"Hi, From Dokploy 👋",
				);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error testing the notification",
					cause: error,
				});
			}
		}),
	// Read-only helper for the "invite member" dialog. This is NOT notification
	// configuration: it only lists the provider names of the caller's own
	// organization (needed to pick which one sends an invitation email) and never
	// returns SMTP/Resend credentials.
	getEmailProviders: withPermission("member", "create").query(
		async ({ ctx }) => {
			const rows = await db.query.notifications.findMany({
				where: eq(
					notifications.organizationId,
					ctx.session.activeOrganizationId,
				),
				with: {
					email: true,
					resend: true,
				},
			});
			return rows
				.filter((row) => !!row.email || !!row.resend)
				.map((row) => ({
					notificationId: row.notificationId,
					name: row.name,
					notificationType: row.notificationType,
				}));
		},
	),
});
