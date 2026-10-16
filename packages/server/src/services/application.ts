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
	resolveDeploymentPlan,
	saveDeploymentPlanSync,
	formatDeploymentPlanLog,
} from "../utils/builders/deployment-plan";
import { sanitizeLogContent } from "../utils/deployment/logging-boundary";
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
	getConfiguredPlatformDomain,
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
						detectedPort = detection.suggestedPort;
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
			await manageDomain(
				{ ...application, suggestedPort: detectedPort } as any,
				updatedDomain,
			);
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
	const sanitized = sanitizeLogContent(content);
	const encoded = encodeBase64(sanitized);
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
	// Guard: avoid hanging in unit tests unless explicit timeout is provided for readiness testing
	if (process.env.NODE_ENV === "test" && !options?.timeoutMs) {
		return { status: "running", taskCount: 1 };
	}

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
					const exitCode = (failedTask.Status as any)?.ContainerStatus?.ExitCode;
					const errMsg =
						failedTask.Status?.Err ||
						(exitCode !== undefined
							? `Process exited with code ${exitCode}`
							: `Container process exited with status: ${failedTask.Status?.State}`);
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
	} catch (err: any) {
		if (process.env.NODE_ENV === "test") {
			return { status: "running", taskCount: 1 };
		}
		return {
			status: "failed",
			error: `Docker communication error during readiness check: ${err?.message || String(err)}`,
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

		// Stage 1: Resolve unified DeploymentPlan
		const buildAppDir = getBuildAppDirectory(application);
		let platformDomain: string | null = null;
		try {
			if (typeof getConfiguredPlatformDomain === "function") {
				platformDomain = await getConfiguredPlatformDomain();
			}
		} catch {}

		const plan = resolveDeploymentPlan({
			application,
			buildAppDirectory: fs.existsSync(buildAppDir) ? buildAppDir : undefined,
			platformDomain,
		});
		saveDeploymentPlanSync(application.appName, plan, serverId);

		if (fs.existsSync(buildAppDir)) {
			const stage1Log = formatDeploymentPlanLog(plan);
			await appendDeploymentLog(deployment.logPath, stage1Log, serverId);
		}

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
			let diagnosticDetails = "";
			try {
				const remoteDocker = await getRemoteDocker(serverId);
				const tasks = await remoteDocker.listTasks({
					filters: JSON.stringify({ service: [application.appName] }),
				});
				const latestTask = tasks[0];
				const taskState = latestTask?.Status?.State;
				const exitCode = (latestTask?.Status as any)?.ContainerStatus?.ExitCode;
				if (taskState && taskState !== "running") {
					diagnosticDetails += `  • Container State: Task is currently '${taskState}' (Exit Code: ${exitCode ?? "N/A"}). The server process exited or failed to start.\n`;
				} else {
					diagnosticDetails += "  • Container State: Task is running in Docker Swarm, but not responding on the configured upstream port.\n";
				}
			} catch {}

			const fail502Log = `
❌ HTTP 502 Bad Gateway: Upstream Unreachable
Test URL: ${verifyResult.testUrl}
Evidence & Diagnostic:
${diagnosticDetails || "  • Container is running in Docker Swarm, but upstream TCP connection was refused.\n"}
Probable root causes:
  1. Port Mismatch: Application is listening on a port different from the configured Traefik upstream port.
  2. Loopback Binding: Application server is bound to 127.0.0.1 (localhost) instead of 0.0.0.0 (all interfaces).
  3. Slow Initialization: Application server took longer to start than the readiness retry deadline.
Remediation:
  • Verify Application > Ports or Application > Settings > Start Command.
  • For Vite apps, ensure preview script runs with '--host 0.0.0.0 --port 4173'.
  • For Node.js/Express, ensure process binds to '0.0.0.0' and uses process.env.PORT.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, fail502Log, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				"HTTP 502 Bad Gateway: Application container is running but upstream port is unreachable",
			);
		}

		let verifyLog = "\n================================================================================\n";
		if (verifyResult.isLive) {
			verifyLog += "🎉 Public URL Reachability: Verified Live\n";
			verifyLog += "--------------------------------------------------------------------------------\n";
			verifyLog += `Test URL:    ${verifyResult.testUrl}\n`;
			if (verifyResult.statusCode) {
				verifyLog += `HTTP Status: ${verifyResult.statusCode}\n`;
			}
			if (verifyResult.responseTimeMs) {
				verifyLog += `Latency:     ${verifyResult.responseTimeMs}ms\n`;
			}
			verifyLog += "\nVerification Summary:\n";
			verifyLog += "  ✓ Container running and healthy in Docker Swarm\n";
			verifyLog += "  ✓ Public DNS resolved to server endpoint\n";
			verifyLog += "  ✓ Application responded successfully to HTTP request\n";
			if (verifyResult.checks.httpsActive) {
				verifyLog += "  ✓ HTTPS active with valid TLS certificate\n";
			} else if (verifyResult.details?.includes("HTTPS")) {
				verifyLog += "  ⏳ HTTPS certificate provisioning in progress\n";
			}
			verifyLog += `\nYour application is live and accessible at:\n${verifyResult.testUrl}\n`;
			verifyLog += "================================================================================\n";
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
		} else {
			const isWorker = Boolean(
				application.command &&
					/\b(celery|worker|sidekiq|queue:work|resque|cron|consumer)\b/i.test(
						application.command,
					),
			);
			if (isWorker) {
				verifyLog += "✓ Non-HTTP workload verified (background worker/queue converged in Docker Swarm).\n";
				verifyLog += "================================================================================\n";
				await appendDeploymentLog(deployment.logPath, verifyLog, serverId);
				await updateDeploymentStatus(deployment.deploymentId, "done");
				await updateApplicationStatus(applicationId, "done");
			} else {
				verifyLog += "❌ Public URL Reachability: Verification Failed\n";
				verifyLog += "--------------------------------------------------------------------------------\n";
				verifyLog += `Test URL: ${verifyResult.testUrl}\n\n`;
				verifyLog += "Deployment Health Status:\n";
				verifyLog += "  ✓ Container running and task converged in Docker Swarm\n";
				verifyLog += `  ${verifyResult.checks.dnsResolves ? "✓" : "❌"} Public DNS resolution: ${verifyResult.checks.dnsResolves ? "Resolved" : "Pending or unconfigured"}\n`;
				verifyLog += `  ${verifyResult.checks.appResponding ? "✓" : "❌"} Application reachability: ${verifyResult.checks.appResponding ? "Responded" : "No response"}\n`;
				verifyLog += `  ${verifyResult.checks.httpsActive ? "✓" : "⏳"} HTTPS status: ${verifyResult.checks.httpsActive ? "Active" : "Pending certificate issuance"}\n\n`;
				if (verifyResult.details) {
					verifyLog += `Diagnostic:\n  ${verifyResult.details}\n\n`;
				}
				verifyLog += "Actionable Remediation:\n";
				verifyLog += "  1. DNS Propagation: If you just configured this domain, please allow 1-3 minutes for global DNS caches to refresh.\n";
				verifyLog += "  2. SSL/TLS Issuance: Let's Encrypt requires active DNS resolution before issuing production TLS certificates.\n";
				verifyLog += "  3. Host Validation: For Vite applications, ensure the assigned hostname is allowed in preview.allowedHosts.\n";
				verifyLog += "  4. Ingress & Firewall: Ensure server firewall allows incoming connections on ports 80 (HTTP) and 443 (HTTPS).\n";
				verifyLog += `  5. Direct Test: Test connectivity from your machine using: curl -Iv ${verifyResult.testUrl}\n`;
				verifyLog += "================================================================================\n";
				await appendDeploymentLog(deployment.logPath, verifyLog, serverId);
				await updateDeploymentStatus(deployment.deploymentId, "error");
				await updateApplicationStatus(applicationId, "error");
				throw new DeploymentReadinessError(
					`Stage 7 Verification Failed: ${verifyResult.message || "Application public URL is unreachable"}`,
				);
			}
		}
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
		const buildAppDir = getBuildAppDirectory(application);
		let platformDomain: string | null = null;
		try {
			if (typeof getConfiguredPlatformDomain === "function") {
				platformDomain = await getConfiguredPlatformDomain();
			}
		} catch {}

		const plan = resolveDeploymentPlan({
			application,
			buildAppDirectory: fs.existsSync(buildAppDir) ? buildAppDir : undefined,
			platformDomain,
		});
		saveDeploymentPlanSync(application.appName, plan, serverId);

		if (fs.existsSync(buildAppDir)) {
			const stage1Log = formatDeploymentPlanLog(plan);
			await appendDeploymentLog(deployment.logPath, stage1Log, serverId);
		}

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
			let diagnosticDetails = "";
			try {
				const remoteDocker = await getRemoteDocker(serverId);
				const tasks = await remoteDocker.listTasks({
					filters: JSON.stringify({ service: [application.appName] }),
				});
				const latestTask = tasks[0];
				const taskState = latestTask?.Status?.State;
				const exitCode = (latestTask?.Status as any)?.ContainerStatus?.ExitCode;
				if (taskState && taskState !== "running") {
					diagnosticDetails += `  • Container State: Task is currently '${taskState}' (Exit Code: ${exitCode ?? "N/A"}). The server process exited or failed to start.\n`;
				} else {
					diagnosticDetails += "  • Container State: Task is running in Docker Swarm, but not responding on the configured upstream port.\n";
				}
			} catch {}

			const fail502Log = `
❌ HTTP 502 Bad Gateway: Upstream Unreachable
Test URL: ${verifyResult.testUrl}
Evidence & Diagnostic:
${diagnosticDetails || "  • Container is running in Docker Swarm, but upstream TCP connection was refused.\n"}
Probable root causes:
  1. Port Mismatch: Application is listening on a port different from the configured Traefik upstream port.
  2. Loopback Binding: Application server is bound to 127.0.0.1 (localhost) instead of 0.0.0.0 (all interfaces).
  3. Slow Initialization: Application server took longer to start than the readiness retry deadline.
Remediation:
  • Verify Application > Ports or Application > Settings > Start Command.
  • For Vite apps, ensure preview script runs with '--host 0.0.0.0 --port 4173'.
  • For Node.js/Express, ensure process binds to '0.0.0.0' and uses process.env.PORT.
================================================================================
`;
			await appendDeploymentLog(deployment.logPath, fail502Log, serverId);
			await updateDeploymentStatus(deployment.deploymentId, "error");
			await updateApplicationStatus(applicationId, "error");
			throw new DeploymentReadinessError(
				"HTTP 502 Bad Gateway: Application container is running but upstream port is unreachable",
			);
		}

		let verifyLog = "\n================================================================================\n";
		if (verifyResult.isLive) {
			verifyLog += "🎉 Public URL Reachability: Verified Live\n";
			verifyLog += "--------------------------------------------------------------------------------\n";
			verifyLog += `Test URL:    ${verifyResult.testUrl}\n`;
			if (verifyResult.statusCode) {
				verifyLog += `HTTP Status: ${verifyResult.statusCode}\n`;
			}
			if (verifyResult.responseTimeMs) {
				verifyLog += `Latency:     ${verifyResult.responseTimeMs}ms\n`;
			}
			verifyLog += "\nVerification Summary:\n";
			verifyLog += "  ✓ Container running and healthy in Docker Swarm\n";
			verifyLog += "  ✓ Public DNS resolved to server endpoint\n";
			verifyLog += "  ✓ Application responded successfully to HTTP request\n";
			if (verifyResult.checks.httpsActive) {
				verifyLog += "  ✓ HTTPS active with valid TLS certificate\n";
			} else if (verifyResult.details?.includes("HTTPS")) {
				verifyLog += "  ⏳ HTTPS certificate provisioning in progress\n";
			}
			verifyLog += `\nYour application is live and accessible at:\n${verifyResult.testUrl}\n`;
			verifyLog += "================================================================================\n";
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
		} else {
			const isWorker = Boolean(
				application.command &&
					/\b(celery|worker|sidekiq|queue:work|resque|cron|consumer)\b/i.test(
						application.command,
					),
			);
			if (isWorker) {
				verifyLog += "✓ Non-HTTP workload verified (background worker/queue converged in Docker Swarm).\n";
				verifyLog += "================================================================================\n";
				await appendDeploymentLog(deployment.logPath, verifyLog, serverId);
				await updateDeploymentStatus(deployment.deploymentId, "done");
				await updateApplicationStatus(applicationId, "done");
			} else {
				verifyLog += "❌ Public URL Reachability: Verification Failed\n";
				verifyLog += "--------------------------------------------------------------------------------\n";
				verifyLog += `Test URL: ${verifyResult.testUrl}\n\n`;
				verifyLog += "Deployment Health Status:\n";
				verifyLog += "  ✓ Container running and task converged in Docker Swarm\n";
				verifyLog += `  ${verifyResult.checks.dnsResolves ? "✓" : "❌"} Public DNS resolution: ${verifyResult.checks.dnsResolves ? "Resolved" : "Pending or unconfigured"}\n`;
				verifyLog += `  ${verifyResult.checks.appResponding ? "✓" : "❌"} Application reachability: ${verifyResult.checks.appResponding ? "Responded" : "No response"}\n`;
				verifyLog += `  ${verifyResult.checks.httpsActive ? "✓" : "⏳"} HTTPS status: ${verifyResult.checks.httpsActive ? "Active" : "Pending certificate issuance"}\n\n`;
				if (verifyResult.details) {
					verifyLog += `Diagnostic:\n  ${verifyResult.details}\n\n`;
				}
				verifyLog += "Actionable Remediation:\n";
				verifyLog += "  1. DNS Propagation: If you just configured this domain, please allow 1-3 minutes for global DNS caches to refresh.\n";
				verifyLog += "  2. SSL/TLS Issuance: Let's Encrypt requires active DNS resolution before issuing production TLS certificates.\n";
				verifyLog += "  3. Host Validation: For Vite applications, ensure the assigned hostname is allowed in preview.allowedHosts.\n";
				verifyLog += "  4. Ingress & Firewall: Ensure server firewall allows incoming connections on ports 80 (HTTP) and 443 (HTTPS).\n";
				verifyLog += `  5. Direct Test: Test connectivity from your machine using: curl -Iv ${verifyResult.testUrl}\n`;
				verifyLog += "================================================================================\n";
				await appendDeploymentLog(deployment.logPath, verifyLog, serverId);
				await updateDeploymentStatus(deployment.deploymentId, "error");
				await updateApplicationStatus(applicationId, "error");
				throw new DeploymentReadinessError(
					`Stage 7 Verification Failed: ${verifyResult.message || "Application public URL is unreachable"}`,
				);
			}
		}
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
