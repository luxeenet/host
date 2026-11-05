import {
	createGithub,
	deriveGithubApiUrl,
	parseGithubBaseUrl,
	validateRequest,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import {
	assertIntegrationAvailable,
	getPlatformGithubIntegration,
} from "@dokploy/server/services/integration-settings";
import {
	OAuthStateError,
	verifyOAuthState,
} from "@dokploy/server/lib/oauth-state";
import { hasPermission } from "@dokploy/server/services/permission";
import { eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { Octokit } from "octokit";
import { github } from "@/server/db/schema";

type Query = {
	code?: string;
	state?: string;
	installation_id?: string;
	setup_action?: string;
	githubUrl?: string;
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	const { code, state, installation_id, setup_action, githubUrl }: Query =
		req.query as Query;

	const { user, session } = await validateRequest(req);
	if (!user || !session?.activeOrganizationId) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	const ctx = {
		user: { id: user.id },
		session: { activeOrganizationId: session.activeOrganizationId },
	};

	if (!(await hasPermission(ctx, { gitProviders: ["create"] }))) {
		return res.status(403).json({ error: "Forbidden" });
	}

	try {
		await assertIntegrationAvailable("github");
	} catch (err: any) {
		return res.status(403).json({
			error: err?.message || "GitHub integration is unavailable.",
		});
	}

	const rawState = typeof state === "string" ? state.trim() : "";
	let action = "";
	let targetGithubId: string | undefined;

	// Verify state and prevent CSRF
	if (rawState) {
		if (rawState.includes(".")) {
			// Signed OAuth state token
			try {
				const verified = verifyOAuthState(rawState, {
					provider: "github",
					userId: user.id,
					organizationId: session.activeOrganizationId,
				});
				action = "gh_setup";
				targetGithubId = verified.i;
			} catch (err) {
				if (err instanceof OAuthStateError) {
					return res.status(403).json({ error: err.message });
				}
				return res.status(403).json({ error: "Invalid authorization state." });
			}
		} else {
			// Legacy colon-separated state format: action:param1:param2
			const [stateAction, part1, part2] = rawState.split(":");
			action = stateAction || "";

			if (action === "gh_init") {
				const stateOrgId = part1;
				const stateUserId = part2;
				if (stateOrgId && stateOrgId !== session.activeOrganizationId) {
					return res
						.status(403)
						.json({ error: "State organization mismatch: request not authorized" });
				}
				if (stateUserId && stateUserId !== user.id) {
					return res
						.status(403)
						.json({ error: "State user mismatch: request not authorized" });
				}
			} else if (action === "gh_setup") {
				targetGithubId = part1;
				if (!targetGithubId) {
					return res.status(400).json({ error: "Missing github provider id" });
				}
			}
		}
	} else if (installation_id || setup_action) {
		action = "gh_setup";
	}

	// 1. GitHub App Manifest conversion flow
	if (action === "gh_init") {
		if (!code) {
			return res.status(400).json({ error: "Missing code parameter" });
		}

		// Reject before any outbound request: this runs on a GET the user can be
		// linked into, so the host is not trusted.
		const parsed = parseGithubBaseUrl(githubUrl);
		if ("error" in parsed) {
			return res.status(400).json({ error: parsed.error });
		}

		const baseUrl = parsed.url;
		const octokit = new Octokit({ baseUrl: deriveGithubApiUrl(baseUrl) });
		const { data } = await octokit.request(
			"POST /app-manifests/{code}/conversions",
			{
				code: code as string,
			},
		);

		await createGithub(
			{
				name: data.name,
				githubAppName: data.html_url,
				githubAppId: data.id,
				githubClientId: data.client_id,
				githubClientSecret: data.client_secret,
				githubWebhookSecret: data.webhook_secret,
				githubPrivateKey: data.pem,
				githubUrl: baseUrl,
			},
			session.activeOrganizationId,
			user.id,
		);

		return res.redirect(307, "/dashboard/settings/git-providers");
	}

	// 2. Standard GitHub App installation or setup redirect
	if (installation_id || action === "gh_setup" || setup_action) {
		if (!installation_id) {
			return res.status(400).json({ error: "Missing installation_id parameter" });
		}

		if (targetGithubId) {
			const provider = await db.query.github.findFirst({
				where: eq(github.githubId, targetGithubId),
				with: { gitProvider: true },
			});
			if (
				!provider ||
				provider.gitProvider.organizationId !== session.activeOrganizationId
			) {
				return res.status(404).json({ error: "Github provider not found" });
			}

			await db
				.update(github)
				.set({
					githubInstallationId: installation_id,
				})
				.where(eq(github.githubId, targetGithubId))
				.returning();

			return res.redirect(307, "/dashboard/settings/git-providers");
		}

		// No explicit targetGithubId in state: match existing unassociated provider
		// for this tenant or use platform GitHub credentials
		const existingProviders = await db.query.github.findMany({
			with: { gitProvider: true },
		});
		const tenantProvider = existingProviders.find(
			(p) =>
				p.gitProvider.organizationId === session.activeOrganizationId &&
				(!p.githubInstallationId || p.githubInstallationId === installation_id),
		);

		if (tenantProvider) {
			await db
				.update(github)
				.set({
					githubInstallationId: installation_id,
				})
				.where(eq(github.githubId, tenantProvider.githubId))
				.returning();

			return res.redirect(307, "/dashboard/settings/git-providers");
		}

		// Check if centralized platform GitHub App is configured
		const platformGh = await getPlatformGithubIntegration();
		if (platformGh) {
			const appSlug = platformGh.appSlug || platformGh.organization || "HatDot";
			await createGithub(
				{
					name: "GitHub",
					githubAppName: platformGh.baseUrl
						? `${platformGh.baseUrl.replace(/\/+$/, "")}/apps/${appSlug.replace(/^https?:\/\/[^/]+\/apps\//, "")}`
						: `https://github.com/apps/${appSlug}`,
					githubAppId: platformGh.appId,
					githubClientId: platformGh.clientId,
					githubClientSecret: platformGh.clientSecret,
					githubWebhookSecret: platformGh.webhookSecret ?? null,
					githubPrivateKey: platformGh.privateKey,
					githubInstallationId: installation_id,
					githubUrl: platformGh.baseUrl,
				},
				session.activeOrganizationId,
				user.id,
			);
			return res.redirect(307, "/dashboard/settings/git-providers");
		}

		return res.status(400).json({
			error: "No matching GitHub provider found to associate with installation",
		});
	}

	return res.status(400).json({
		error: "Missing required parameters: code or installation_id",
	});
}
