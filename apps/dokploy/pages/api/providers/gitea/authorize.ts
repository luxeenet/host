import type { NextApiRequest, NextApiResponse } from "next";
import { validateRequest } from "@dokploy/server";
import {
	assertInstanceAllowed,
	assertIntegrationAvailable,
} from "@dokploy/server/services/integration-settings";
import {
	buildNonceCookie,
	createOAuthState,
} from "@dokploy/server/lib/oauth-state";
import { findGitea, redirectWithError } from "./helper";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	try {
		if (req.method !== "GET") {
			return res.status(405).json({ error: "Method not allowed" });
		}

		const { user, session } = await validateRequest(req);
		if (!user || !session?.activeOrganizationId) {
			return redirectWithError(res, "Please sign in first");
		}

		try {
			await assertIntegrationAvailable("gitea");
		} catch (err: any) {
			return redirectWithError(
				res,
				err?.message || "Gitea integration is currently disabled",
			);
		}

		const { giteaId } = req.query;

		if (!giteaId || Array.isArray(giteaId)) {
			return res.status(400).json({ error: "Invalid Gitea provider ID" });
		}

		const gitea = await findGitea(giteaId as string);
		if (!gitea || !gitea.clientId || !gitea.redirectUri) {
			return redirectWithError(res, "Incomplete OAuth configuration");
		}

		if (
			gitea.gitProvider?.organizationId &&
			gitea.gitProvider.organizationId !== session.activeOrganizationId
		) {
			return redirectWithError(res, "Unauthorized");
		}

		await assertInstanceAllowed("gitea", gitea.giteaUrl);

		const { state, nonce } = createOAuthState({
			provider: "gitea",
			providerId: gitea.giteaId,
			userId: user.id,
			organizationId: session.activeOrganizationId,
		});

		res.setHeader(
			"Set-Cookie",
			buildNonceCookie(nonce, { secure: process.env.NODE_ENV === "production" }),
		);

		// Generate the Gitea authorization URL
		const authorizationUrl = new URL(`${gitea.giteaUrl}/login/oauth/authorize`);
		authorizationUrl.searchParams.append("client_id", gitea.clientId as string);
		authorizationUrl.searchParams.append("response_type", "code");
		authorizationUrl.searchParams.append(
			"redirect_uri",
			gitea.redirectUri as string,
		);
		authorizationUrl.searchParams.append("scope", "read:user repo");
		authorizationUrl.searchParams.append("state", state);

		// Redirect user to Gitea authorization URL
		return res.redirect(307, authorizationUrl.toString());
	} catch (error) {
		console.error("Error initiating Gitea OAuth flow:", error);
		return res.status(500).json({ error: "Internal server error" });
	}
}
