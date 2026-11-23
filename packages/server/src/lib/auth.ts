import { brand } from "@paas/branding";
import type { IncomingMessage } from "node:http";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import * as bcrypt from "bcrypt";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { and, desc, eq } from "drizzle-orm";
import { IS_CLOUD } from "../constants";
import { db } from "../db";
import * as schema from "../db/schema";
import {
	getDokployUrl,
	getTrustedOrigins,
	getTrustedProviders,
	getUserByToken,
} from "../services/admin";
import { createAuditLog } from "../services/platform-audit";

/**
 * Resolves the default role for new members joining via SSO/SCIM.
 * Returns "member" — customisable per org via platform settings in future.
 */
async function resolveOrganizationDefaultRole(
	_organizationId: string,
): Promise<"owner" | "admin" | "member"> {
	return "member";
}
import {
	getWebServerSettings,
	updateWebServerSettings,
} from "../services/web-server-settings";
import { getHubSpotUTK, submitToHubSpot } from "../utils/tracking/hubspot";
import {
	sendEmail,
	sendInvitationEmail,
	sendVerificationEmail,
} from "../verification/send-verification-email";
import { getPublicIpWithFallback } from "../wss/utils";
import { ac, adminRole, memberRole, ownerRole } from "./access-control";
import { betterAuthSecret } from "./auth-secret";

const resolveTrustedOrigins = async () => {
	try {
		if (IS_CLOUD) {
			return await getTrustedOrigins();
		}
		const [trustedOrigins, settings] = await Promise.all([
			getTrustedOrigins(),
			getWebServerSettings(),
		]);

		if (!settings) return [];

		const devOrigins =
			process.env.NODE_ENV === "development"
				? [
						"http://localhost:3000",
						"https://absolutely-handy-falcon.ngrok-free.app",
					]
				: [];
		return [
			...(settings?.serverIp ? [`http://${settings?.serverIp}:3000`] : []),
			...(settings?.host ? [`https://${settings?.host}`] : []),
			"https://hatdot.cloud",
			"https://panel.hatdot.cloud",
			...devOrigins,
			...trustedOrigins,
		];
	} catch (error) {
		console.error("Failed to resolve trusted origins:", error);
		return [];
	}
};

const createBetterAuth = () =>
	betterAuth({
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: schema,
		}),
		disabledPaths: [
			"/sso/register",
			"/organization/create",
			"/organization/update",
			"/organization/delete",
		],
		secret: betterAuthSecret,
		onAPIError: {
			errorURL: "/",
		},
		...(!IS_CLOUD
			? {
					advanced: {
						useSecureCookies: false,
						defaultCookieAttributes: {
							sameSite: "lax",
							secure: false,
							httpOnly: true,
							path: "/",
						},
					},
				}
			: {}),

		baseURL:
			process.env.BETTER_AUTH_URL ||
			process.env.NEXT_PUBLIC_APP_URL ||
			(process.env.NODE_ENV === "test" ? "http://localhost:3000" : undefined),
		account: {
			accountLinking: {
				enabled: true,
				async trustedProviders() {
					const fromDb = await getTrustedProviders();
					return ["github", "google", ...fromDb];
				},
				allowDifferentEmails: true,
			},
		},
		appName: brand.APP_NAME,
		socialProviders: {
			...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: process.env.GITHUB_CLIENT_ID,
							clientSecret: process.env.GITHUB_CLIENT_SECRET,
						},
					}
				: {}),
			...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: process.env.GOOGLE_CLIENT_ID,
							clientSecret: process.env.GOOGLE_CLIENT_SECRET,
						},
					}
				: {}),
		},
		logger: {
			disabled: process.env.NODE_ENV === "production",
		},
		trustedOrigins: resolveTrustedOrigins,
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				ctx.context.trustedOrigins = [
					...(ctx.context.baseURL ? [new URL(ctx.context.baseURL).origin] : []),
					...(await resolveTrustedOrigins()),
				].filter(Boolean);

				const isBlockedAuthPath =
					ctx.path.startsWith("/sign-in/email") ||
					ctx.path.startsWith("/sign-in/social") ||
					ctx.path.startsWith("/sign-in/passkey") ||
					ctx.path.startsWith("/sign-up/email") ||
					ctx.path.startsWith("/passkey/verify-authentication") ||
					ctx.path.startsWith("/passkey/generate-authenticate-options");

				if (!IS_CLOUD && isBlockedAuthPath) {
					const settings = await getWebServerSettings();
					if (settings?.enforceSSO) {
						throw new APIError("FORBIDDEN", {
							message:
								"SSO is enforced. Direct password, social, and passkey sign-in are disabled.",
						});
					}
				}
			}),
		},
		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendOnSignIn: true,
			sendVerificationEmail: async ({ user, url }) => {
				try {
					await sendVerificationEmail({
						userName: user.name || "User",
						email: user.email,
						verificationUrl: url,
					});
				} catch (err) {
					console.error(`[emailVerification] Failed to send email to ${user.email}:`, err);
				}
			},
		},
		emailAndPassword: {
			enabled: true,
			autoSignIn: !IS_CLOUD,
			requireEmailVerification:
				IS_CLOUD && process.env.NODE_ENV === "production",
			password: {
				async hash(password) {
					return bcrypt.hashSync(password, 10);
				},
				async verify({ hash, password }) {
					return bcrypt.compareSync(password, hash);
				},
			},
			sendResetPassword: async ({ user, url }) => {
				const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #09090b; padding: 32px 40px; text-align: center;">
      <div style="display: inline-flex; align-items: center; gap: 10px;">
        <div style="width: 28px; height: 28px; border-radius: 8px; background-color: #d97706; display: inline-block; vertical-align: middle;"></div>
        <span style="color: #ffffff; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; vertical-align: middle;">${brand.APP_NAME}</span>
      </div>
    </div>
    <div style="padding: 40px 40px 32px;">
      <h1 style="color: #09090b; font-size: 22px; font-weight: 600; margin: 0 0 12px;">Reset Your Password</h1>
      <p style="color: #71717a; font-size: 14px; line-height: 24px; margin: 0 0 28px;">
        Hello ${user.name || "there"}, we received a request to reset your ${brand.APP_NAME} account password. Click the button below to choose a new password.
      </p>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${url}" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25);">Reset Password</a>
      </div>
      <p style="color: #d97706; font-size: 12px; line-height: 18px; margin: 0 0 20px; text-align: center; font-weight: 500;">
        ⏱️ For security, this link is valid for 1 hour.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 20px; margin: 0 0 16px;">
        If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
      <p style="color: #a1a1aa; font-size: 12px; line-height: 18px; margin: 0; word-break: break-all;">
        If the button above does not work, copy and paste this link into your browser:<br />
        <a href="${url}" style="color: #3b82f6; text-decoration: underline;">${url}</a>
      </p>
    </div>
    <div style="background-color: #fafafa; padding: 20px 40px; text-align: center; border-top: 1px solid #e4e4e7;">
      <p style="color: #a1a1aa; font-size: 12px; line-height: 18px; margin: 0;">
        This is an automated security notification from <a href="${brand.MARKETING_URL}" style="color: #71717a; text-decoration: underline; font-weight: 500;">${brand.APP_NAME}</a>.
      </p>
    </div>
  </div>
</body>
</html>
`;
				await sendEmail({
					email: user.email,
					subject: `Reset your ${brand.APP_NAME} password`,
					html: htmlContent,
					text: `Reset your ${brand.APP_NAME} password by visiting: ${url}`,
				});
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (_user, context) => {
						if (context?.path.includes("/scim")) {
							return { data: { emailVerified: true } };
						}
						if (!IS_CLOUD) {
							const xDokployToken =
								context?.request?.headers?.get("x-dokploy-token");
							if (xDokployToken) {
								let invitation: Awaited<ReturnType<typeof getUserByToken>>;
								try {
									invitation = await getUserByToken(xDokployToken);
								} catch {
									throw new APIError("BAD_REQUEST", {
										message: "Invalid invitation token",
									});
								}
								if (invitation.isExpired) {
									throw new APIError("BAD_REQUEST", {
										message: "Invitation has expired",
									});
								}
								if (invitation.status !== "pending") {
									throw new APIError("BAD_REQUEST", {
										message: "Invitation has already been used",
									});
								}
								if (
									_user.email.toLowerCase().trim() !==
									invitation.email.toLowerCase().trim()
								) {
									throw new APIError("BAD_REQUEST", {
										message: "Email does not match invitation",
									});
								}
							} else {
								const isSSORequest = context?.path.includes("/sso");
								const isSignUpPath =
									context?.path.includes("/sign-up") ||
									context?.path.includes("/signup");
								if (isSSORequest || isSignUpPath) {
									return;
								}
								const isAdminPresent = await db.query.member.findFirst({
									where: eq(schema.member.role, "owner"),
								});
								if (isAdminPresent) {
									throw new APIError("BAD_REQUEST", {
										message: "Admin is already created",
									});
								}
							}
						}
					},
					after: async (user, context) => {
						const isSSORequest = context?.path.includes("/sso");
						const isSCIMRequest = context?.path.includes("/scim");
						const isAdminPresent = await db.query.member.findFirst({
							where: eq(schema.member.role, "owner"),
						});

						if (!isAdminPresent) {
							await db.update(schema.user).set({ isPlatformAdmin: true }).where(eq(schema.user.id, user.id));
						}
						if (!IS_CLOUD && !isAdminPresent) {
							await updateWebServerSettings({
								serverIp: await getPublicIpWithFallback(),
							});
						}

						if (IS_CLOUD) {
							try {
								const hutk = getHubSpotUTK(
									context?.request?.headers?.get("cookie") || undefined,
								);
								// Cast to include additional fields
								const userWithFields = user as typeof user & {
									lastName?: string;
								};
								const hubspotSuccess = await submitToHubSpot(
									{
										email: user.email,
										firstName: user.name || "", // name is mapped to firstName column
										lastName: userWithFields.lastName || "",
									},
									hutk,
								);
								if (!hubspotSuccess) {
									console.error("Failed to submit to HubSpot");
								}
							} catch (error) {
								console.error("Error submitting to HubSpot", error);
							}
						}

						if (isSCIMRequest) {
							const membership = await db.query.member.findFirst({
								where: eq(schema.member.userId, user.id),
							});
							if (membership) {
								const defaultRole = await resolveOrganizationDefaultRole(
									membership.organizationId,
								);
								if (defaultRole !== membership.role) {
									await db
										.update(schema.member)
										.set({ role: defaultRole })
										.where(eq(schema.member.id, membership.id));
								}
							}
							return;
						}

						const isSignUpPath =
							context?.path.includes("/sign-up") ||
							context?.path.includes("/signup");

						if (IS_CLOUD || !isAdminPresent || isSignUpPath) {
							await db.transaction(async (tx) => {
								const organization = await tx
									.insert(schema.organization)
									.values({
										name: `${user.name || "Customer"}'s Workspace`,
										ownerId: user.id,
										createdAt: new Date(),
									})
									.returning()
									.then((res) => res[0]);

								await tx.insert(schema.member).values({
									userId: user.id,
									organizationId: organization?.id || "",
									role: "owner",
									createdAt: new Date(),
									isDefault: true, // Mark first organization as default
								});
							});
						} else if (isSSORequest) {
							const providerId = context?.params?.providerId;
							if (!providerId) {
								throw new APIError("BAD_REQUEST", {
									message: "Provider ID is required",
								});
							}
							const provider = await db.query.ssoProvider.findFirst({
								where: eq(schema.ssoProvider.providerId, providerId),
							});

							if (!provider) {
								throw new APIError("BAD_REQUEST", {
									message: "Provider not found",
								});
							}
							const defaultRole = provider.organizationId
								? await resolveOrganizationDefaultRole(provider.organizationId)
								: "member";
							await db.insert(schema.member).values({
								userId: user.id,
								organizationId: provider?.organizationId || "",
								role: defaultRole,
								createdAt: new Date(),
								isDefault: true,
							});
						}
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						// Find the default organization for this user
						// Priority: 1) isDefault=true, 2) most recently created
						const member = await db.query.member.findFirst({
							where: eq(schema.member.userId, session.userId),
							orderBy: [
								desc(schema.member.isDefault),
								desc(schema.member.createdAt),
							],
							with: {
								organization: true,
							},
						});

						return {
							data: {
								...session,
								activeOrganizationId: member?.organization.id,
							},
						};
					},
					after: async (session) => {
						const orgId = (
							session as typeof session & { activeOrganizationId?: string }
						).activeOrganizationId;
						if (!orgId) return;
						const memberRecord = await db.query.member.findFirst({
							where: and(
								eq(schema.member.userId, session.userId),
								eq(schema.member.organizationId, orgId),
							),
							with: { user: true },
						});
						if (!memberRecord) return;
						await createAuditLog({
							organizationId: orgId,
							userId: session.userId,
							userEmail: memberRecord.user.email,
							userRole: memberRecord.role,
							action: "login",
							resourceType: "session",
						});
					},
				},
				delete: {
					after: async (session) => {
						const orgId = (
							session as typeof session & { activeOrganizationId?: string }
						).activeOrganizationId;
						if (!orgId) return;
						const memberRecord = await db.query.member.findFirst({
							where: and(
								eq(schema.member.userId, session.userId),
								eq(schema.member.organizationId, orgId),
							),
							with: { user: true },
						});
						if (!memberRecord) return;
						await createAuditLog({
							organizationId: orgId,
							userId: session.userId,
							userEmail: memberRecord.user.email,
							userRole: memberRecord.role,
							action: "logout",
							resourceType: "session",
						});
					},
				},
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 3,
			updateAge: 60 * 60 * 24,
		},
		user: {
			modelName: "user",
			fields: {
				name: "firstName", // Map better-auth's default 'name' field to 'firstName' column
			},
			additionalFields: {
				role: {
					type: "string",
					// required: true,
					input: false,
				},
				ownerId: {
					type: "string",
					// required: true,
					input: false,
				},
				allowImpersonation: {
					fieldName: "allowImpersonation",
					type: "boolean",
					defaultValue: false,
				},
				lastName: {
					type: "string",
					required: false,
					input: true,
					defaultValue: "",
				},
				enableEnterpriseFeatures: {
					type: "boolean",
					required: false,
					input: false,
				},
				isValidEnterpriseLicense: {
					type: "boolean",
					required: false,
					input: false,
				},
				// Platform-level administrator flag. Read-only from the client; it is
				// resolved from the database in `validateRequest` so that server-side
				// guards and tRPC procedures see the same value as the dashboard UI.
				isPlatformAdmin: {
					type: "boolean",
					required: false,
					input: false,
				},
			},
		},
		plugins: [
			apiKey({
				enableMetadata: true,
				references: "user",
			}),
			sso({ trustEmailVerified: true }),
			scim({
				beforeSCIMTokenGenerated: async ({ user }) => {
					const dbUser = await db.query.user.findFirst({
						where: eq(schema.user.id, user.id),
						columns: { enableEnterpriseFeatures: true },
					});

					if (!dbUser?.enableEnterpriseFeatures) {
						throw new APIError("FORBIDDEN", {
							message: "SCIM provisioning requires an enterprise license",
						});
					}
				},
			}),
			twoFactor(),
			passkey(),
			organization({
				ac,
				roles: {
					owner: ownerRole,
					admin: adminRole,
					member: memberRole,
				},
				dynamicAccessControl: {
					enabled: true,
					maximumRolesPerOrganization: 10,
				},
				sendInvitationEmail: async (data) => {
					try {
						const baseUrl = await getDokployUrl();
						const inviteLink = `${baseUrl}/invitation?token=${data.id}`;
						await sendInvitationEmail({
							email: data.email,
							inviteLink,
							organizationName: data.organization?.name || "organization",
						});
					} catch (error) {
						console.error(
							`[auth] Failed to dispatch invitation email to ${data.email}:`,
							error,
						);
					}
				},
			}),
			// Self-hosted needs the admin plugin too: SCIM deactivation (active: false)
			// maps to the admin plugin's `banned` field and is rejected without it.
			// adminRoles: [] keeps every /admin/* endpoint locked on self-hosted.
			admin(
				IS_CLOUD
					? { adminUserIds: [process.env.USER_ADMIN_ID as string] }
					: { adminRoles: [] },
			),
		],
	});

// Una sola instancia de better-auth por proceso aunque el módulo esté
// duplicado en varios bundles.
const globalForAuth = globalThis as unknown as {
	betterAuthInstance?: ReturnType<typeof createBetterAuth>;
};

if (!globalForAuth.betterAuthInstance) {
	globalForAuth.betterAuthInstance = createBetterAuth();
}

const { handler, api } = globalForAuth.betterAuthInstance;

const _auth = {
	handler,
	createApiKey: api.createApiKey,
	registerSSOProvider: api.registerSSOProvider,
	updateSSOProvider: api.updateSSOProvider,
	generateSCIMToken: api.generateSCIMToken,
	listSCIMProviderConnections: api.listSCIMProviderConnections,
	deleteSCIMProviderConnection: api.deleteSCIMProviderConnection,
};

export type AuthType = typeof _auth;
export const auth: AuthType = _auth;

export const validateRequest = async (request: IncomingMessage) => {
	const apiKey = request.headers["x-api-key"] as string;
	if (apiKey) {
		try {
			const { valid, key, error } = await api.verifyApiKey({
				body: {
					key: apiKey,
				},
			});

			if (error) {
				throw new Error(error.message?.toString() || "Error verifying API key");
			}
			if (!valid || !key) {
				return {
					session: null,
					user: null,
				};
			}

			const apiKeyRecord = await db.query.apikey.findFirst({
				where: eq(schema.apikey.id, key.id),
				with: {
					user: true,
				},
			});

			if (!apiKeyRecord) {
				return {
					session: null,
					user: null,
				};
			}

			const organizationId = (
				JSON.parse(apiKeyRecord.metadata || "{}") as {
					organizationId?: string;
				}
			).organizationId;

			if (!organizationId) {
				return {
					session: null,
					user: null,
				};
			}

			const member = await db.query.member.findFirst({
				where: and(
					eq(schema.member.userId, apiKeyRecord.user.id),
					eq(schema.member.organizationId, organizationId),
				),
				with: {
					organization: true,
				},
			});

			// When accessing from DB, use actual column names
			const userFromDb = apiKeyRecord.user as typeof apiKeyRecord.user & {
				firstName: string;
				lastName: string;
			};

			const mockSession = {
				session: {
					userId: apiKeyRecord.user.id,
					activeOrganizationId: organizationId || "",
				},
				user: {
					id: userFromDb.id,
					name: userFromDb.firstName, // Map firstName back to name for better-auth
					email: userFromDb.email,
					emailVerified: userFromDb.emailVerified,
					image: userFromDb.image,
					createdAt: userFromDb.createdAt,
					updatedAt: userFromDb.updatedAt,
					twoFactorEnabled: userFromDb.twoFactorEnabled,
					role: member?.role || "member",
					ownerId: member?.organization.ownerId || apiKeyRecord.user.id,
					enableEnterpriseFeatures: userFromDb.enableEnterpriseFeatures,
					isValidEnterpriseLicense: userFromDb.isValidEnterpriseLicense,
					isPlatformAdmin: userFromDb.isPlatformAdmin === true,
				},
			};

			return mockSession;
		} catch (error) {
			console.error("Error verifying API key", error);
			return {
				session: null,
				user: null,
			};
		}
	}

	// If no API key, proceed with normal session validation
	const session = await api.getSession({
		headers: new Headers({
			cookie: request.headers.cookie || "",
		}),
	});

	if (!session?.session || !session.user) {
		return {
			session: null,
			user: null,
		};
	}

	if (session?.user) {
		const member = await db.query.member.findFirst({
			where: and(
				eq(schema.member.userId, session.user.id),
				...(session.session.activeOrganizationId
					? [
							eq(
								schema.member.organizationId,
								session.session.activeOrganizationId || "",
							),
						]
					: []),
			),
			orderBy: [desc(schema.member.isDefault), desc(schema.member.createdAt)],
			with: {
				organization: true,
				user: true,
			},
		});

		session.user.role = member?.role || "member";
		session.user.enableEnterpriseFeatures =
			member?.user.enableEnterpriseFeatures || false;
		session.user.isValidEnterpriseLicense =
			member?.user.isValidEnterpriseLicense || false;
		// Resolve the platform-admin flag straight from the DB row. Better-auth
		// only returns declared fields, and a user may have no membership row in
		// the active organization, so fall back to a direct user lookup.
		let isPlatformAdmin = member?.user?.isPlatformAdmin;
		if (isPlatformAdmin === undefined) {
			const dbUser = await db.query.user.findFirst({
				where: eq(schema.user.id, session.user.id),
				columns: { isPlatformAdmin: true },
			});
			isPlatformAdmin = dbUser?.isPlatformAdmin;
		}
		session.user.isPlatformAdmin = isPlatformAdmin === true || Boolean(process.env.USER_ADMIN_ID && session.user.id === process.env.USER_ADMIN_ID);
		session.session.activeOrganizationId = member?.organization.id || "";
		if (member) {
			session.user.ownerId = member.organization.ownerId;
		} else {
			session.user.ownerId = session.user.id;
		}
	}

	return session;
};
