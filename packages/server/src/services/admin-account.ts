/**
 * Admin Account & Resource Management Service
 *
 * Provides platform administrators with complete control over customer accounts,
 * comprehensive resource lifecycle management (stopping containers, removing volumes,
 * clearing directories), and individual service deprovisioning.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { removeCompose } from "./compose";
import { deleteProject } from "./project";
import { removeVolume } from "./docker-volume";
import {
	removeDirectoryCode,
	removeMonitoringDirectory,
	removeComposeDirectory,
} from "../utils/filesystem/directory";
import { removeTraefikConfig } from "../utils/traefik/application";
import { removeService } from "../utils/docker/utils";
import { findApplicationById } from "./application";
import { findComposeById } from "./compose";

/**
 * Permanently purge a customer account and all associated resources:
 * - Stops and removes all application containers
 * - Stops and removes all compose stacks with volumes
 * - Stops and removes all database containers and data volumes
 * - Deletes all projects, environments, and services
 * - Purges billing records, invoices, payments, and subscriptions
 * - Removes sessions, authentication accounts, and the user record
 */
export async function purgeCustomerAccount(
	userId: string,
	actingAdminId?: string,
): Promise<{ success: boolean; purgedApplications: number; purgedCompose: number; purgedDatabases: number }> {
	if (userId === process.env.USER_ADMIN_ID) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The root platform administrator account cannot be deleted.",
		});
	}

	if (actingAdminId && userId === actingAdminId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You cannot delete your own platform administrator account.",
		});
	}

	const targetUser = await db.query.user.findFirst({
		where: eq(schema.user.id, userId),
		with: {
			organizations: true,
		},
	});

	if (!targetUser) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Customer account not found.",
		});
	}

	let purgedAppsCount = 0;
	let purgedComposeCount = 0;
	let purgedDatabasesCount = 0;

	// 1. Gather all organizations owned by this user
	const ownedOrgs = await db.query.organization.findMany({
		where: eq(schema.organization.ownerId, userId),
		with: {
			projects: {
				with: {
					environments: {
						with: {
							applications: {
								with: {
									mounts: true,
								},
							},
							compose: true,
							postgres: { with: { mounts: true } },
							mariadb: { with: { mounts: true } },
							mysql: { with: { mounts: true } },
							mongo: { with: { mounts: true } },
							redis: { with: { mounts: true } },
							libsql: { with: { mounts: true } },
						},
					},
				},
			},
		},
	});

	// 2. Deprovision every project, service, container, and volume in owned organizations
	for (const org of ownedOrgs) {
		for (const project of org.projects) {
			for (const env of project.environments) {
				// A. Applications
				for (const app of env.applications) {
					purgedAppsCount++;
					try {
						await removeTraefikConfig(app.appName, app.serverId);
					} catch (_) {}
					try {
						await removeService(app.appName, app.serverId, true);
					} catch (_) {}
					try {
						await removeDirectoryCode(app.appName, app.serverId);
					} catch (_) {}
					try {
						await removeMonitoringDirectory(app.appName, app.serverId);
					} catch (_) {}

					// Remove all associated docker volumes
					for (const mount of app.mounts || []) {
						if (mount.volumeName) {
							try {
								await removeVolume(mount.volumeName, app.serverId ?? undefined);
							} catch (_) {}
						}
					}
				}

				// B. Compose stacks (removes containers & volumes)
				for (const comp of env.compose) {
					purgedComposeCount++;
					try {
						await removeCompose(comp as any, true);
					} catch (_) {}
					try {
						await removeComposeDirectory(comp.appName, comp.serverId);
					} catch (_) {}
					try {
						await removeTraefikConfig(comp.appName, comp.serverId);
					} catch (_) {}
				}

				// C. Databases
				const dbs = [
					...env.postgres,
					...env.mariadb,
					...env.mysql,
					...env.mongo,
					...env.redis,
					...env.libsql,
				];

				for (const d of dbs) {
					purgedDatabasesCount++;
					try {
						await removeService(d.appName, d.serverId, true);
					} catch (_) {}
					try {
						await removeTraefikConfig(d.appName, d.serverId);
					} catch (_) {}
					try {
						await removeVolume(`${d.appName}-data`, d.serverId ?? undefined);
					} catch (_) {}

					for (const mount of (d as any).mounts || []) {
						if (mount.volumeName) {
							try {
								await removeVolume(mount.volumeName, d.serverId ?? undefined);
							} catch (_) {}
						}
					}
				}
			}

			// Delete project from database (cascades environments, services, mounts, domains)
			try {
				await deleteProject(project.projectId);
			} catch (err) {
				console.error(`[admin-account] Error deleting project ${project.projectId}:`, err);
			}
		}

		// Delete billing records for the organization
		try {
			await db.delete(schema.payments).where(eq(schema.payments.organizationId, org.id));
			await db.delete(schema.invoices).where(eq(schema.invoices.organizationId, org.id));
			await db.delete(schema.subscriptions).where(eq(schema.subscriptions.organizationId, org.id));
			await db.delete(schema.member).where(eq(schema.member.organizationId, org.id));
			await db.delete(schema.organization).where(eq(schema.organization.id, org.id));
		} catch (err) {
			console.error(`[admin-account] Error cleaning org ${org.id}:`, err);
		}
	}

	// 3. Remove user from any other organizations they were a member of
	try {
		await db.delete(schema.member).where(eq(schema.member.userId, userId));
	} catch (_) {}

	// 4. Delete auth sessions and accounts
	try {
		await db.delete(schema.session).where(eq(schema.session.userId, userId));
		await db.delete(schema.account).where(eq(schema.account.userId, userId));
	} catch (_) {}

	// 5. Delete the user record
	await db.delete(schema.user).where(eq(schema.user.id, userId));

	return {
		success: true,
		purgedApplications: purgedAppsCount,
		purgedCompose: purgedComposeCount,
		purgedDatabases: purgedDatabasesCount,
	};
}

/**
 * Delete an individual customer application as a platform administrator:
 * - Stops container & removes docker service
 * - Removes Traefik routing configuration
 * - Cleans code directory and monitoring
 * - Removes application volumes
 * - Deletes application record from database
 */
export async function deleteCustomerApplication(applicationId: string): Promise<boolean> {
	const application = await findApplicationById(applicationId);
	if (!application) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Application not found.",
		});
	}

	// Stop & remove service container
	try {
		await removeService(application.appName, application.serverId, true);
	} catch (_) {}

	// Remove routing
	try {
		await removeTraefikConfig(application.appName, application.serverId);
	} catch (_) {}

	// Remove code directory
	try {
		await removeDirectoryCode(application.appName, application.serverId);
	} catch (_) {}

	// Remove monitoring directory
	try {
		await removeMonitoringDirectory(application.appName, application.serverId);
	} catch (_) {}

	// Remove all associated docker volumes
	for (const mount of application.mounts || []) {
		if (mount.volumeName) {
			try {
				await removeVolume(mount.volumeName, application.serverId ?? undefined);
			} catch (_) {}
		}
	}

	// Delete from database
	await db
		.delete(schema.applications)
		.where(eq(schema.applications.applicationId, applicationId));

	return true;
}

/**
 * Delete an individual customer compose stack as a platform administrator:
 * - Tears down compose stack with volumes (`docker compose down -v`)
 * - Removes Traefik configuration
 * - Cleans compose directory
 * - Deletes compose record from database
 */
export async function deleteCustomerCompose(composeId: string): Promise<boolean> {
	const comp = await findComposeById(composeId);
	if (!comp) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Compose stack not found.",
		});
	}

	try {
		await removeCompose(comp as any, true);
	} catch (_) {}

	try {
		await removeComposeDirectory(comp.appName, comp.serverId);
	} catch (_) {}

	try {
		await removeTraefikConfig(comp.appName, comp.serverId);
	} catch (_) {}

	await db
		.delete(schema.compose)
		.where(eq(schema.compose.composeId, composeId));

	return true;
}

