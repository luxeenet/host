import fs from "node:fs";
import path from "node:path";
import { docker, paths } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import { parse } from "yaml";
import { getRemoteDocker } from "../utils/servers/remote-docker";
import {
	type apiCreateApplication,
	applications,
	buildAppName,
} from "@dokploy/server/db/schema";
import { getAdvancedStats } from "@dokploy/server/monitoring/utils";
import {
	getBuildCommand,
	mechanizeDockerContainer,
} from "@dokploy/server/utils/builders";
import { sendBuildErrorNotifications } from "@dokploy/server/utils/notifications/build-error";
import { sendBuildSuccessNotifications } from "@dokploy/server/utils/notifications/build-success";
import {
	ExecError,
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { cloneBitbucketRepository } from "@dokploy/server/utils/providers/bitbucket";
import { buildRemoteDocker } from "@dokploy/server/utils/providers/docker";
import {
	cloneGitRepository,
	getGitCommitInfo,
} from "@dokploy/server/utils/providers/git";
import { cloneGiteaRepository } from "@dokploy/server/utils/providers/gitea";
import { cloneGithubRepository } from "@dokploy/server/utils/providers/github";
import { cloneGitlabRepository } from "@dokploy/server/utils/providers/gitlab";
import { createTraefikConfig } from "@dokploy/server/utils/traefik/application";
import { manageDomain } from "@dokploy/server/utils/traefik/domain";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { encodeBase64 } from "../utils/docker/utils";
import { getDokployUrl } from "./admin";
import {
	detectFrameworkFromDirectory,
	extractPortFromCommand,
} from "./app-detector";
import { getBuildAppDirectory } from "../utils/filesystem/directory";
import {
	createDeployment,
	createDeploymentPreview,
	updateDeployment,
	updateDeploymentStatus,
} from "./deployment";
import {
	type Domain,
	findDomainsByApplicationId,
	getDomainHost,
	updateDomainById,
	verifyApplicationLiveUrl,
} from "./domain";
import {
	createPreviewDeploymentComment,
	getIssueComment,
	issueCommentExists,
	updateIssueComment,
} from "./github";
import { generateApplyPatchesCommand } from "./patch";
import { PlanEntitlementService } from "./plan-entitlement";
import {
	findPreviewDeploymentById,
	updatePreviewDeployment,
} from "./preview-deployment";
import { validUniqueServerAppName } from "./project";
export type Application = typeof applications.$inferSelect;

export const syncApplicationDomainsTraefik = async (applicationId: string) => {
	const application = await findApplicationById(applicationId);
	if (!application) return;

	let explicitPort: number | undefined;
	// 1. Check if application environment variables explicitly set PORT
	if (application.env) {
		try {
			const parsedEnv = parse(application.env);
			if (parsedEnv?.PORT && !Number.isNaN(Number(parsedEnv.PORT))) {
				explicitPort = Number(parsedEnv.PORT);
			}
		} catch {}
	}
	if (
		!explicitPort &&
		application.ports &&
		application.ports.length > 0 &&
		application.ports[0]?.targetPort
	) {
		explicitPort = application.ports[0].targetPort;
	}

	let detectedPort = explicitPort ?? 3000;
	if (!explicitPort) {
		const cmdPort = extractPortFromCommand(application.command);
		if (cmdPort) {
			detectedPort = cmdPort;
		} else if (application.buildType === "static") {
			detectedPort = 80;
		} else {
			try {
				const buildDir = getBuildAppDirectory(application);
				if (fs.existsSync(buildDir)) {
					const detection = await detectFrameworkFromDirectory(buildDir);
					if (detection?.suggestedPort) {
						if (application.buildType === "nixpacks" && detection.suggestedPort === 80) {
							detectedPort = 3000;
						} else {
							detectedPort = detection.suggestedPort;
						}
					}
				} else if (application.buildType === "dockerfile") {
					detectedPort = 80;
				}
			} catch {}
		}
	}

	const appDomains = await findDomainsByApplicationId(applicationId);
	for (const domain of appDomains) {
		if (domain.enabled) {
			let domainPort = domain.port;
			if (
				application.buildType === "static" &&
				(!domainPort || domainPort === 3000)
			) {
				domainPort = 80;
				await updateDomainById(domain.domainId, { port: 80 });
			} else if (
				!domainPort ||
				(domainPort === 3000 && detectedPort !== 3000)
			) {
				domainPort = detectedPort;
				await updateDomainById(domain.domainId, { port: detectedPort });
			}

			const updatedDomain = {
				...domain,
				port: domainPort,
			};
			await manageDomain(application as any, updatedDomain);
		}
	}
};

export class DeploymentReadinessError extends Error {
	constructor(
		message: string,
		public details?: string,
	) {
		super(message);
		this.name = "DeploymentReadinessError";
	}
}

export const appendDeploymentLog = async (
	logPath: string,
	content: string,
	serverId?: string | null,
) => {
	const encoded = encodeBase64(content);
	const cmd = `echo "${encoded}" | base64 -d >> "${logPath}";`;
	if (serverId) {
		await execAsyncRemote(serverId, cmd).catch(() => {});
	} else {
		await execAsync(cmd).catch(() => {});
	}
};

export const verifyContainerReadiness = async (
	appName: string,
	serverId?: string | null,
	options?: { timeoutMs?: number; intervalMs?: number },
): Promise<
	| { status: "running"; taskCount: number }
	| { status: "failed"; error: string }
> => {
	const timeoutMs = options?.timeoutMs ?? 30_000;
	const intervalMs = options?.intervalMs ?? 1_500;
	try {
		const remoteDocker = await getRemoteDocker(serverId);
		const deadline = Date.now() + timeoutMs;
		let lastState = "starting";

		while (Date.now() < deadline) {
			try {
				const tasks = await remoteDocker.listTasks({
					filters: JSON.stringify({ service: [appName] }),
				});
				const currentTasks = tasks.filter(
					(task) => task.DesiredState === "running",
				);

				const failedTask = currentTasks.find((task) =>
					["failed", "rejected", "shutdown"].includes(task.Status?.State ?? ""),
				);

				if (failedTask) {
					const errMsg =
						failedTask.Status?.Err ||
						`Container process exited with status: ${failedTask.Status?.State}`;
					return { status: "failed", error: errMsg };
				}

				const runningTasks = currentTasks.filter(
					(task) => task.Status?.State === "running",
				);

				if (runningTasks.length > 0) {
					return { status: "running", taskCount: runningTasks.length };
				}

				lastState = currentTasks[0]?.Status?.State ?? lastState;
			} catch {
				// transient docker error
			}

			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

		return {
			status: "failed",
			error: `Service ${appName} did not reach running state within ${timeoutMs / 1000}s (last state: ${lastState})`,
		};
	} catch {
		return {
			status: "running",
			taskCount: 1,
		};
	}
};

export const createApplication = async (
	input: z.infer<typeof apiCreateApplication>,
	tx: any = db,
) => {
	const appName = buildAppName("app", input.appName);

	const valid = await validUniqueServerAppName(appName);
	if (!valid) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Application with this 'AppName' already exists",
		});
	}

	const newApplication = await tx
		.insert(applications)
		.values({
			...input,
			appName,
		})
		.returning()
		.then((value: any) => value[0]);

	if (!newApplication) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error creating the application",
		});
	}

	if (process.env.NODE_ENV === "development") {
		createTraefikConfig(newApplication.appName);
	}

	return newApplication;
};

export const findApplicationById = async (applicationId: string) => {
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
		with: {
			environment: { with: { project: true } },
			domains: true,
			deployments: true,
			mounts: true,
			redirects: true,
			security: true,
			ports: true,
			gitlab: {
				columns: { secret: false, accessToken: false, refreshToken: false },
			},
			github: {
				columns: {
					githubClientSecret: false,
					githubPrivateKey: false,
					githubWebhookSecret: false,
				},
			},
			bitbucket: { columns: { appPassword: false, apiToken: false } },
			gitea: {
				columns: {
					clientSecret: false,
					accessToken: false,
					refreshToken: false,
				},
			},
			server: true,
			previewDeployments: true,
			registry: { columns: { password: false } },
			buildRegistry: { columns: { password: false } },
			rollbackRegistry: { columns: { password: false } },
		},
	});
	if (!application) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Application not found",
		});
	}
	return application;
};

export const findApplicationByName = async (appName: string) => {
	const application = await db.query.applications.findFirst({
		where: eq(applications.appName, appName),
	});

	return application;
};

const assertApplicationRuntimeResources = async (
	application: Awaited<ReturnType<typeof findApplicationById>>,
) => {
	await PlanEntitlementService.assertRuntimeResources(
		application.environment.project.organizationId,
		{
			memoryLimit: application.memoryLimit,
			memoryReservation: application.memoryReservation,
			cpuLimit: application.cpuLimit,
			cpuReservation: application.cpuReservation,
		},
	);
};

export const updateApplication = async (
	applicationId: string,
	applicationData: Partial<Application>,
) => {
	const resourceFieldsChanged =
		applicationData.memoryLimit !== undefined ||
		applicationData.memoryReservation !== undefined ||
		applicationData.cpuLimit !== undefined ||
		applicationData.cpuReservation !== undefined;

	if (resourceFieldsChanged) {
		const currentApplication = await findApplicationById(applicationId);
		await PlanEntitlementService.assertRuntimeResources(
			currentApplication.environment.project.organizationId,
			{
				memoryLimit:
					applicationData.memoryLimit !== undefined
						? applicationData.memoryLimit
						: currentApplication.memoryLimit,
				memoryReservation:
					applicationData.memoryReservation !== undefined
						? applicationData.memoryReservation
						: currentApplication.memoryReservation,
				cpuLimit:
					applicationData.cpuLimit !== undefined
						? applicationData.cpuLimit
						: currentApplication.cpuLimit,
				cpuReservation:
					applicationData.cpuReservation !== undefined
						? applicationData.cpuReservation
						: currentApplication.cpuReservation,
			},
		);
	}

	const { appName, ...rest } = applicationData;
	const application = await db
		.update(applications)
		.set({
			...rest,
		})
		.where(eq(applications.applicationId, applicationId))
		.returning();

	return application[0];
};

export const updateApplicationStatus = async (
	applicationId: string,
	applicationStatus: Application["applicationStatus"],
) => {
	const application = await db
		.update(applications)
		.set({
			applicationStatus: applicationStatus,
		})
		.where(eq(applications.applicationId, applicationId))
		.returning();

	return application;
};

export const deployApplication = async ({
	applicationId,
	titleLog = "Manual deployment",
	descriptionLog = "",
}: {
	applicationId: string;
	titleLog: string;
	descriptionLog: string;
}) => {
	const application = await findApplicationById(applicationId);
	await assertApplicationRuntimeResources(application);
	const serverId = application.buildServerId || application.serverId;
	const applicationEntity = {
		...application,
		serverId: serverId,
	};

	const buildLink = `${await getDokployUrl()}/dashboard/project/${application.environment.projectId}/environment/${application.environmentId}/services/application/${application.applicationId}?tab=deployments`;
	const deployment = await createDeployment({
		applicationId: applicationId,
		title: titleLog,
		description: descriptionLog,
	});

	try {
		let command = "set -e;";
		if (application.sourceType === "github") {
			command += await cloneGithubRepository(applicationEntity);
		} else if (application.sourceType === "gitlab") {
			command += await cloneGitlabRepository(applicationEntity);
		} else if (application.sourceType === "gitea") {
			command += await cloneGiteaRepository(applicationEntity);
		} else if (application.sourceType === "bitbucket") {
			command += await cloneBitbucketRepository(applicationEntity);
		} else if (application.sourceType === "git") {
			command += await cloneGitRepository(applicationEntity);
		} else if (application.sourceType === "docker") {
			command += await buildRemoteDocker(application);
		}

		if (application.sourceType !== "docker") {
			command += await generateApplyPatchesCommand({
				id: application.applicationId,
				type: "application",
				serverId,
			});
		}

		try {
			const buildAppDir = getBuildAppDirectory(application);
			if (fs.existsSync(buildAppDir)) {
				const inspection = await detectFrameworkFromDirectory(buildAppDir);
				const packageManager = inspection.packageManager || (inspection.language === "Python" ? "pip" : "npm");
				const startupCommand = application.command || inspection.startCommand || "default";
				let expectedPort = inspection.suggestedPort;
				const cmdPort = extractPortFromCommand(startupCommand);
				if (cmdPort) {
					expectedPort = cmdPort;
				} else if (application.buildType === "nixpacks" && expectedPort === 80) {
					expectedPort = 3000;
				}
				const stage1Log = `
================================================================================
Stage 1/7: Configuration & Framework Detection
--------------------------------------------------------------------------------
Selected Builder:      ${application.buildType}
Detected Framework:    ${inspection.framework} (${inspection.language})
Runtime Version:       ${inspection.runtimeVersion || "standard"}
Package Manager:       ${packageManager}
Startup Command:       ${startupCommand}
Expected Port:         ${expectedPort}
================================================================================
`;
				await appendDeploymentLog(deployment.logPath, stage1Log, serverId);
			}
		} catch {}

		command += await getBuildCommand(application);

		const commandWithLog = `(${command}) >> ${deployment.logPath} 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, commandWithLog);
		} else {
			await execAsync(commandWithLog);
		}

		// Stage 4: Image Creation
		const stage4Log = `
================================================================================
Stage 4/7: Image Packaging
--------------------------------------------------------------------------------
Docker image packaged successfully for ${application.appName}.
`;
		await appendDeploymentLog(deployment.logPath, stage4Log, serverId);

		// Stage 5: Container Startup
		const stage5Log = `
================================================================================
Stage 5/7: Container Startup & Orchestration
--------------------------------------------------------------------------------
Deploying Docker Swarm service for ${application.appName}...
`;
		await appendDeploymentLog(deployment.logPath, stage5Log, serverId);
		await mechanizeDockerContainer(application);

		// Stage 6: Application Readiness
		const stage6Log = `
================================================================================
Stage 6/7: Application Health & Readiness Convergence
--------------------------------------------------------------------------------
Verifying container process health and task convergence...
`;
		await appendDeploymentLog(deployment.logPath, stage6Log, serverId);
		const readiness = await verifyContainerReadiness(
			application.appName,
			application.serverId,
		);

		if (readiness.status === "failed") {
			const crashLog = `
❌ Container Startup Failed: Process crashed or exited prematurely.
Reason: ${readiness.error}
Actionable Diagnostic:
  1. Inspect container logs via Application > Logs to view runtime crash details or stack traces.
  2. Verify start command syntax and environment variables.
  3. Ensure application binds to 0.0.0.0 and listens on the expected port.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, crashLog, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				`Container failed to start: ${readiness.error}`,
			);
		}

		try {
			await syncApplicationDomainsTraefik(applicationId);
		} catch (syncErr) {
			console.error(`Error syncing domains for ${application.appName}:`, syncErr);
		}

		// Stage 7: Routing & Upstream Reachability
		const stage7Log = `
================================================================================
Stage 7/7: Public URL & Upstream Reachability Verification
--------------------------------------------------------------------------------
Testing HTTP upstream reachability through routing layer...
`;
		await appendDeploymentLog(deployment.logPath, stage7Log, serverId);

		const verifyResult = await verifyApplicationLiveUrl(applicationId, {
			maxRetries: 3,
			retryDelayMs: 2000,
		});

		// Check if Traefik returned 502 Bad Gateway
		if (
			!verifyResult.isLive &&
			verifyResult.checks.deploymentHealthy &&
			!verifyResult.checks.appResponding &&
			verifyResult.details?.includes("502")
		) {
			const fail502Log = `
❌ HTTP 502 Bad Gateway: Upstream Unreachable
Test URL: ${verifyResult.testUrl}
Diagnostic:
  Traefik is running, but cannot establish a TCP connection to the container's internal port.
Possible causes:
  1. The application process is binding only to 127.0.0.1 (localhost) instead of 0.0.0.0.
  2. The application is listening on a port different from the configured upstream port.
  3. The server process exited or stopped accepting connections.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, fail502Log, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				"HTTP 502 Bad Gateway: Application container is running but upstream port is unreachable",
			);
		}

		let verifyLog = "\n========================================\n";
		if (verifyResult.isLive) {
			verifyLog += "Your application is live.\n\n";
			verifyLog += `Test URL:\n${verifyResult.testUrl}\n\n`;
			verifyLog += "✓ Deployment healthy\n";
			verifyLog += "✓ DNS reachable\n";
			verifyLog += "✓ Application responding\n";
			if (verifyResult.checks.httpsActive) {
				verifyLog += "✓ HTTPS active\n";
			}
		} else {
			verifyLog += "Notice regarding public URL reachability:\n";
			if (verifyResult.details) {
				verifyLog += `${verifyResult.details}\n`;
			}
		}
		verifyLog += "========================================\n";
		await appendDeploymentLog(deployment.logPath, verifyLog, serverId);

		await updateDeploymentStatus(deployment.deploymentId, "done");
		await updateApplicationStatus(applicationId, "done");

		await sendBuildSuccessNotifications({
			projectName: application.environment.project.name,
			applicationName: application.name,
			applicationType: "application",
			buildLink,
			organizationId: application.environment.project.organizationId,
			domains: application.domains,
			environmentName: application.environment.name,
		});
	} catch (error) {
		let command = "";

		// Only log details for non-ExecError errors
		if (!(error instanceof ExecError)) {
			const message = error instanceof Error ? error.message : String(error);
			const encodedMessage = encodeBase64(message);
			command += `echo "${encodedMessage}" | base64 -d >> "${deployment.logPath}";`;
		}

		command += `echo "\nError occurred ❌, check the logs for details." >> ${deployment.logPath};`;
		if (serverId) {
			await execAsyncRemote(serverId, command);
		} else {
			await execAsync(command);
		}
		await updateDeploymentStatus(deployment.deploymentId, "error");
		await updateApplicationStatus(applicationId, "error");

		await sendBuildErrorNotifications({
			projectName: application.environment.project.name,
			applicationName: application.name,
			applicationType: "application",
			// @ts-ignore
			errorMessage: error?.message || "Error building",
			buildLink,
			organizationId: application.environment.project.organizationId,
		});

		throw error;
	} finally {
		// Only extract commit info for non-docker sources
		if (application.sourceType !== "docker") {
			const commitInfo = await getGitCommitInfo({
				appName: application.appName,
				type: "application",
				serverId: serverId,
			});
			if (commitInfo) {
				await updateDeployment(deployment.deploymentId, {
					title: commitInfo.message,
					description: `Commit: ${commitInfo.hash}`,
				});
			}
		}
	}
	return true;
};

export const rebuildApplication = async ({
	applicationId,
	titleLog = "Rebuild deployment",
	descriptionLog = "",
}: {
	applicationId: string;
	titleLog: string;
	descriptionLog: string;
}) => {
	const application = await findApplicationById(applicationId);
	await assertApplicationRuntimeResources(application);
	const serverId = application.buildServerId || application.serverId;
	const buildLink = `${await getDokployUrl()}/dashboard/project/${application.environment.projectId}/environment/${application.environmentId}/services/application/${application.applicationId}?tab=deployments`;

	const deployment = await createDeployment({
		applicationId: applicationId,
		title: titleLog,
		description: descriptionLog,
	});

	try {
		let command = "set -e;";
		// Check case for docker only
		command += await getBuildCommand(application);
		const commandWithLog = `(${command}) >> ${deployment.logPath} 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, commandWithLog);
		} else {
			await execAsync(commandWithLog);
		}
		// Stage 5: Container Startup
		const stage5Log = `
================================================================================
Stage 5/7: Container Startup & Orchestration
--------------------------------------------------------------------------------
Deploying Docker Swarm service for ${application.appName}...
`;
		await appendDeploymentLog(deployment.logPath, stage5Log, serverId);
		await mechanizeDockerContainer(application);

		// Stage 6: Application Readiness
		const stage6Log = `
================================================================================
Stage 6/7: Application Health & Readiness Convergence
--------------------------------------------------------------------------------
Verifying container process health and task convergence...
`;
		await appendDeploymentLog(deployment.logPath, stage6Log, serverId);
		const readiness = await verifyContainerReadiness(
			application.appName,
			application.serverId,
		);

		if (readiness.status === "failed") {
			const crashLog = `
❌ Container Startup Failed: Process crashed or exited prematurely.
Reason: ${readiness.error}
Actionable Diagnostic:
  1. Inspect container logs via Application > Logs to view runtime crash details or stack traces.
  2. Verify start command syntax and environment variables.
  3. Ensure application binds to 0.0.0.0 and listens on the expected port.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, crashLog, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				`Container failed to start: ${readiness.error}`,
			);
		}

		try {
			await syncApplicationDomainsTraefik(applicationId);
		} catch (syncErr) {
			console.error(`Error syncing domains for ${application.appName}:`, syncErr);
		}

		// Stage 7: Routing & Upstream Reachability
		const stage7Log = `
================================================================================
Stage 7/7: Public URL & Upstream Reachability Verification
--------------------------------------------------------------------------------
Testing HTTP upstream reachability through routing layer...
`;
		await appendDeploymentLog(deployment.logPath, stage7Log, serverId);

		const verifyResult = await verifyApplicationLiveUrl(applicationId, {
			maxRetries: 3,
			retryDelayMs: 2000,
		});

		// Check if Traefik returned 502 Bad Gateway
		if (
			!verifyResult.isLive &&
			verifyResult.checks.deploymentHealthy &&
			!verifyResult.checks.appResponding &&
			verifyResult.details?.includes("502")
		) {
			const fail502Log = `
❌ HTTP 502 Bad Gateway: Upstream Unreachable
Test URL: ${verifyResult.testUrl}
Diagnostic:
  Traefik is running, but cannot establish a TCP connection to the container's internal port.
Possible causes:
  1. The application process is binding only to 127.0.0.1 (localhost) instead of 0.0.0.0.
  2. The application is listening on a port different from the configured upstream port.
  3. The server process exited or stopped accepting connections.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, fail502Log, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				"HTTP 502 Bad Gateway: Application container is running but upstream port is unreachable",
			);
		}

		let verifyLog = "\n========================================\n";
		if (verifyResult.isLive) {
			verifyLog += "Your application is live.\n\n";
			verifyLog += `Test URL:\n${verifyResult.testUrl}\n\n`;
			verifyLog += "✓ Deployment healthy\n";
			verifyLog += "✓ DNS reachable\n";
			verifyLog += "✓ Application responding\n";
			if (verifyResult.checks.httpsActive) {
				verifyLog += "✓ HTTPS active\n";
			}
		} else {
			verifyLog += "Notice regarding public URL reachability:\n";
			if (verifyResult.details) {
				verifyLog += `${verifyResult.details}\n`;
			}
		}
		verifyLog += "========================================\n";
		await appendDeploymentLog(deployment.logPath, verifyLog, serverId);

		await updateDeploymentStatus(deployment.deploymentId, "done");
		await updateApplicationStatus(applicationId, "done");

		await sendBuildSuccessNotifications({
			projectName: application.environment.project.name,
			applicationName: application.name,
			applicationType: "application",
			buildLink,
			organizationId: application.environment.project.organizationId,
			domains: application.domains,
			environmentName: application.environment.name,
		});
	} catch (error) {
		let command = "";

		// Only log details for non-ExecError errors
		if (!(error instanceof ExecError)) {
			const message = error instanceof Error ? error.message : String(error);
			const encodedMessage = encodeBase64(message);
			command += `echo "${encodedMessage}" | base64 -d >> "${deployment.logPath}";`;
		}

		command += `echo "\nError occurred ❌, check the logs for details." >> ${deployment.logPath};`;
		if (serverId) {
			await execAsyncRemote(serverId, command);
		} else {
			await execAsync(command);
		}
		await updateDeploymentStatus(deployment.deploymentId, "error");
		await updateApplicationStatus(applicationId, "error");
		throw error;
	}

	return true;
};

export const deployPreviewApplication = async ({
	applicationId,
	titleLog = "Preview Deployment",
	descriptionLog = "",
	previewDeploymentId,
}: {
	applicationId: string;
	titleLog: string;
	descriptionLog: string;
	previewDeploymentId: string;
}) => {
	const application = await findApplicationById(applicationId);
	await assertApplicationRuntimeResources(application);

	const deployment = await createDeploymentPreview({
		title: titleLog,
		description: descriptionLog,
		previewDeploymentId: previewDeploymentId,
	});

	const previewDeployment =
		await findPreviewDeploymentById(previewDeploymentId);

	await updatePreviewDeployment(previewDeploymentId, {
		createdAt: new Date().toISOString(),
	});

	const previewDomain = getDomainHost(previewDeployment?.domain as Domain);
	const issueParams = {
		owner: application?.owner || "",
		repository: application?.repository || "",
		issue_number: previewDeployment.pullRequestNumber,
		comment_id: Number.parseInt(previewDeployment.pullRequestCommentId),
		githubId: application?.githubId || "",
	};
	try {
		const commentExists = await issueCommentExists({
			...issueParams,
		});
		if (!commentExists) {
			const result = await createPreviewDeploymentComment({
				...issueParams,
				previewDomain,
				appName: previewDeployment.appName,
				githubId: application?.githubId || "",
				previewDeploymentId,
			});

			if (!result) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Pull request comment not found",
				});
			}

			issueParams.comment_id = Number.parseInt(result?.pullRequestCommentId);
		}
		const buildingComment = getIssueComment(
			application.name,
			"running",
			previewDomain,
		);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${buildingComment}`,
		});
		application.appName = previewDeployment.appName;
		application.env = `${application.previewEnv}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.buildArgs = `${application.previewBuildArgs}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.buildSecrets = `${application.previewBuildSecrets}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.rollbackActive = false;
		application.buildRegistry = null;
		application.rollbackRegistry = null;
		application.registry = null;

		let command = "set -e;";
		if (application.sourceType === "github") {
			command += await cloneGithubRepository({
				...application,
				appName: previewDeployment.appName,
				branch: previewDeployment.branch,
			});
			command += await getBuildCommand(application);

			const commandWithLog = `(${command}) >> ${deployment.logPath} 2>&1`;
			if (application.serverId) {
				await execAsyncRemote(application.serverId, commandWithLog);
			} else {
				await execAsync(commandWithLog);
			}
			await mechanizeDockerContainer(application);
		}
		const successComment = getIssueComment(
			application.name,
			"success",
			previewDomain,
		);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${successComment}`,
		});
		await updateDeploymentStatus(deployment.deploymentId, "done");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "done",
		});
	} catch (error) {
		const comment = getIssueComment(application.name, "error", previewDomain);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${comment}`,
		});
		await updateDeploymentStatus(deployment.deploymentId, "error");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "error",
		});
		throw error;
	}

	return true;
};

export const rebuildPreviewApplication = async ({
	applicationId,
	titleLog = "Rebuild Preview Deployment",
	descriptionLog = "",
	previewDeploymentId,
}: {
	applicationId: string;
	titleLog: string;
	descriptionLog: string;
	previewDeploymentId: string;
}) => {
	const application = await findApplicationById(applicationId);
	await assertApplicationRuntimeResources(application);
	const previewDeployment =
		await findPreviewDeploymentById(previewDeploymentId);

	const deployment = await createDeploymentPreview({
		title: titleLog,
		description: descriptionLog,
		previewDeploymentId: previewDeploymentId,
	});

	const previewDomain = getDomainHost(previewDeployment?.domain as Domain);
	const issueParams = {
		owner: application?.owner || "",
		repository: application?.repository || "",
		issue_number: previewDeployment.pullRequestNumber,
		comment_id: Number.parseInt(previewDeployment.pullRequestCommentId),
		githubId: application?.githubId || "",
	};

	try {
		const commentExists = await issueCommentExists({
			...issueParams,
		});
		if (!commentExists) {
			const result = await createPreviewDeploymentComment({
				...issueParams,
				previewDomain,
				appName: previewDeployment.appName,
				githubId: application?.githubId || "",
				previewDeploymentId,
			});

			if (!result) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Pull request comment not found",
				});
			}

			issueParams.comment_id = Number.parseInt(result?.pullRequestCommentId);
		}

		const buildingComment = getIssueComment(
			application.name,
			"running",
			previewDomain,
		);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${buildingComment}`,
		});

		// Set application properties for preview deployment
		application.appName = previewDeployment.appName;
		application.env = `${application.previewEnv}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.buildArgs = `${application.previewBuildArgs}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.buildSecrets = `${application.previewBuildSecrets}\nDOKPLOY_DEPLOY_URL=${previewDeployment?.domain?.host}`;
		application.rollbackActive = false;
		application.buildRegistry = null;
		application.rollbackRegistry = null;
		application.registry = null;

		const serverId = application.serverId;
		let command = "set -e;";
		// Only rebuild, don't clone repository
		command += await getBuildCommand(application);
		const commandWithLog = `(${command}) >> ${deployment.logPath} 2>&1`;
		if (serverId) {
			await execAsyncRemote(serverId, commandWithLog);
		} else {
			await execAsync(commandWithLog);
		}
		await mechanizeDockerContainer(application);

		const successComment = getIssueComment(
			application.name,
			"success",
			previewDomain,
		);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${successComment}`,
		});
		await updateDeploymentStatus(deployment.deploymentId, "done");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "done",
		});
	} catch (error) {
		let command = "";

		// Only log details for non-ExecError errors
		if (!(error instanceof ExecError)) {
			const message = error instanceof Error ? error.message : String(error);
			const encodedMessage = encodeBase64(message);
			command += `echo "${encodedMessage}" | base64 -d >> "${deployment.logPath}";`;
		}

		command += `echo "\nError occurred ❌, check the logs for details." >> ${deployment.logPath};`;
		const serverId = application.buildServerId || application.serverId;
		if (serverId) {
			await execAsyncRemote(serverId, command);
		} else {
			await execAsync(command);
		}

		const comment = getIssueComment(application.name, "error", previewDomain);
		await updateIssueComment({
			...issueParams,
			body: `### Dokploy Preview Deployment\n\n${comment}`,
		});
		await updateDeploymentStatus(deployment.deploymentId, "error");
		await updatePreviewDeployment(previewDeploymentId, {
			previewStatus: "error",
		});
		throw error;
	}

	return true;
};

export const getApplicationStats = async (appName: string) => {
	if (appName === "dokploy") {
		return await getAdvancedStats(appName);
	}
	const filter = {
		status: ["running"],
		label: [`com.docker.swarm.service.name=${appName}`],
	};

	const containers = await docker.listContainers({
		filters: JSON.stringify(filter),
	});

	const container = containers[0];
	if (!container || container?.State !== "running") {
		return null;
	}

	const data = await getAdvancedStats(appName);

	return data;
};
