import { db } from "@dokploy/server/db";
import { webServerSettings } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Get the web server settings (singleton - only one row should exist)
 */
let webServerSettingsDbUnavailableUntil = 0;
export const getWebServerSettings = async () => {
	if (Date.now() < webServerSettingsDbUnavailableUntil) return null;
	try {
		const settings = await db.query.webServerSettings.findFirst({
			orderBy: (settings, { asc }) => [asc(settings.createdAt)],
		});

		if (!settings) {
			// Create default settings if none exist
			const [newSettings] = await db
				.insert(webServerSettings)
				.values({})
				.returning();

			return newSettings;
		}

		return settings;
	} catch {
		webServerSettingsDbUnavailableUntil = Date.now() + 30_000;
		return null;
	}
};

/**
 * Update web server settings
 */
export const updateWebServerSettings = async (
	updates: Partial<typeof webServerSettings.$inferInsert>,
) => {
	const current = await getWebServerSettings();

	const [updated] = await db
		.update(webServerSettings)
		.set({
			...updates,
			updatedAt: new Date(),
		})
		.where(eq(webServerSettings.id, current?.id ?? ""))
		.returning();

	return updated;
};
