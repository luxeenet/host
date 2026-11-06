import fs from "node:fs";
import path from "node:path";
import { findApplicationById } from "./application";
import { inspectAndSelectBuilder, type StructuredInspectionResult } from "./intelligent-builder";
import { getBuildAppDirectory } from "../utils/filesystem/directory";
import { getRemoteDocker } from "../utils/servers/remote-docker";

export type ReadinessStatus =
	| "ready_to_build"
	| "ready_with_warnings"
	| "configuration_required"
	| "unsupported_project"
	| "infrastructure_unavailable";

export interface ReadinessCheckItem {
	category:
		| "source"
		| "project_root"
		| "framework"
		| "runtime"
		| "commands"
		| "environment"
		| "port_and_routing"
		| "infrastructure";
	name: string;
	status: "pass" | "warn" | "fail";
	message: string;
	actionableRemediation?: string;
}

export interface DeploymentReadinessReport {
	applicationId: string;
	appName: string;
	status: ReadinessStatus;
	summary: string;
	canDeploy: boolean;
	checks: ReadinessCheckItem[];
	blockingIssues: string[];
	warnings: string[];
	inspection?: StructuredInspectionResult;
	checkedAt: string;
}

export interface CheckDeploymentReadinessOptions {
	applicationId?: string;
	inspection?: StructuredInspectionResult;
	requiredEnvVars?: string[];
	configuredEnvVars?: string[];
}

/**
 * Evaluates comprehensive pre-deployment readiness for a HatDot application.
 * Distinguishes between completely ready, ready with non-fatal warnings,
 * configuration required, unsupported projects, and infrastructure issues.
 */
export const checkDeploymentReadiness = async (
	input: string | CheckDeploymentReadinessOptions,
): Promise<DeploymentReadinessReport> => {
	const checkedAt = new Date().toISOString();

	// Support direct object input for fast in-memory test evaluation
	if (typeof input === "object" && input.inspection) {
		const inspection = input.inspection;
		const checks: ReadinessCheckItem[] = [];

		if (input.requiredEnvVars && input.requiredEnvVars.length > 0) {
			const configured = new Set(input.configuredEnvVars || []);
			for (const reqVar of input.requiredEnvVars) {
				if (!configured.has(reqVar)) {
					checks.push({
						category: "environment",
						name: "Required Variable",
						status: "fail",
						message: `Missing required environment variable: ${reqVar}`,
						actionableRemediation: `Define ${reqVar} in Application Environment variables.`,
					});
				}
			}
		}

		if (inspection.warnings && inspection.warnings.length > 0) {
			for (const warn of inspection.warnings) {
				checks.push({
					category: "framework",
					name: "Framework Warning",
					status: "warn",
					message: warn,
				});
			}
		}

		if (inspection.confidence === "low") {
			checks.push({
				category: "framework",
				name: "Detection Confidence",
				status: "warn",
				message: "Framework detection confidence is low.",
			});
		}

		const hasFail = checks.some((c) => c.status === "fail");
		const hasWarn = checks.some((c) => c.status === "warn");

		let status: ReadinessStatus = "ready_to_build";
		let summary = "All pre-deployment checks passed.";
		let canDeploy = true;

		if (hasFail) {
			status = "configuration_required";
			summary = "Configuration required: one or more required settings or variables are missing.";
			canDeploy = false;
		} else if (hasWarn) {
			status = "ready_with_warnings";
			summary = "Project is ready to build with non-blocking warnings.";
			canDeploy = true;
		}

		const blockingIssues = checks.filter((c) => c.status === "fail").map((c) => c.message);
		const warningsList = checks.filter((c) => c.status === "warn").map((c) => c.message);

		return {
			applicationId: input.applicationId || "app-direct",
			appName: inspection.detectedFramework || "Application",
			status,
			summary,
			canDeploy,
			checks,
			blockingIssues,
			warnings: warningsList,
			inspection,
			checkedAt,
		};
	}

	const applicationId = typeof input === "string" ? input : (input.applicationId || "");
	let app: any = null;
	try {
		app = await findApplicationById(applicationId);
	} catch {}

	const checks: ReadinessCheckItem[] = [];

	if (!app) {
		return {
			applicationId,
			appName: "Unknown",
			status: "configuration_required",
			summary: "Application record not found in platform database.",
			canDeploy: false,
			checks: [
				{
					category: "source",
					name: "Application Existence",
					status: "fail",
					message: `No application found with ID ${applicationId}`,
				},
			],
			blockingIssues: [`No application found with ID ${applicationId}`],
			warnings: [],
			checkedAt,
		};
	}

	const serverId = app.buildServerId || app.serverId;

	// 1. Infrastructure Check (Docker / Swarm availability)
	let infraOk = true;
	try {
		const docker = await getRemoteDocker(serverId);
		await docker.ping();
		checks.push({
			category: "infrastructure",
			name: "Docker Engine & Swarm Cluster",
			status: "pass",
			message: "Docker Swarm daemon is responsive and ready to accept build tasks.",
		});
	} catch (dockerErr) {
		infraOk = false;
		checks.push({
			category: "infrastructure",
			name: "Docker Engine & Swarm Cluster",
			status: "fail",
			message: `Docker engine connection failed on server: ${dockerErr instanceof Error ? dockerErr.message : String(dockerErr)}`,
			actionableRemediation: "Verify the target host is online and the Docker service is running.",
		});
	}

	if (!infraOk) {
		return {
			applicationId,
			appName: app.appName,
			status: "infrastructure_unavailable",
			summary: "Deployment blocked: Docker Swarm infrastructure is currently unreachable.",
			canDeploy: false,
			checks,
			blockingIssues: checks.filter((c) => c.status === "fail").map((c) => c.message),
			warnings: checks.filter((c) => c.status === "warn").map((c) => c.message),
			checkedAt,
		};
	}

	// 2. Source Availability Check
	const { sourceType } = app;
	let sourceOk = true;
	if (sourceType === "github" || sourceType === "gitlab" || sourceType === "bitbucket" || sourceType === "gitea") {
		const repo = (app as any).repository;
		const branch = (app as any).branch;
		if (!repo) {
			sourceOk = false;
			checks.push({
				category: "source",
				name: "Git Repository Selection",
				status: "fail",
				message: `No ${sourceType} repository has been selected for this application.`,
				actionableRemediation: "Select a repository in Application Settings > Source.",
			});
		} else {
			checks.push({
				category: "source",
				name: "Git Repository & Branch",
				status: "pass",
				message: `Connected to repository ${repo} on branch ${branch || "main"}.`,
			});
		}
	} else if (sourceType === "git") {
		const gitUrl = (app as any).customGitUrl;
		if (!gitUrl) {
			sourceOk = false;
			checks.push({
				category: "source",
				name: "Custom Git URL",
				status: "fail",
				message: "Custom Git repository URL is empty.",
				actionableRemediation: "Configure a valid Git HTTPS or SSH clone URL.",
			});
		} else {
			checks.push({
				category: "source",
				name: "Custom Git URL",
				status: "pass",
				message: `Git repository configured: ${gitUrl}`,
			});
		}
	} else if (sourceType === "docker") {
		const dockerImage = (app as any).dockerImage;
		if (!dockerImage) {
			sourceOk = false;
			checks.push({
				category: "source",
				name: "Docker Image Reference",
				status: "fail",
				message: "No Docker image specified.",
				actionableRemediation: "Enter a valid container image (e.g. nginx:alpine or registry.example.com/app:v1).",
			});
		} else {
			checks.push({
				category: "source",
				name: "Docker Image Reference",
				status: "pass",
				message: `Configured container image: ${dockerImage}`,
			});
		}
	}

	// 3. Project Root & Inspection
	const buildDir = getBuildAppDirectory(app);
	let inspection: StructuredInspectionResult | undefined;

	if (sourceType !== "docker") {
		try {
			inspection = await inspectAndSelectBuilder({
				baseDirectory: buildDir,
				explicitRoot: app.buildPath || undefined,
			});

			checks.push({
				category: "project_root",
				name: "Project Root & Directory Layout",
				status: inspection.isMonorepo ? "warn" : "pass",
				message: inspection.isMonorepo
					? `Monorepo workspace detected. Targeting '${inspection.projectRoot}'.`
					: `Application root resolved to '${inspection.projectRoot}'.`,
				actionableRemediation: inspection.isMonorepo
					? "Verify the configured Build Path points to the specific component you wish to deploy."
					: undefined,
			});

			// Framework check
			const isRecognized = inspection.confidence !== "low" && inspection.detectedFramework !== "Generic Application";
			checks.push({
				category: "framework",
				name: "Framework & Architecture Detection",
				status: isRecognized ? "pass" : "warn",
				message: `Detected ${inspection.detectedFramework} (${inspection.detectedLanguage}) with ${inspection.confidence} confidence. Builder: ${inspection.selectedBuilder}.`,
				actionableRemediation: !isRecognized
					? "Consider creating a hatdot.yaml or Dockerfile for explicit build commands."
					: undefined,
			});

			// Runtime version check
			checks.push({
				category: "runtime",
				name: "Language Runtime & Package Manager",
				status: "pass",
				message: `Resolved runtime: ${inspection.detectedRuntimeVersion} using ${inspection.detectedPackageManager}.`,
			});

			// Commands check
			const needsStartCmd = inspection.selectedBuilder !== "static" && inspection.selectedBuilder !== "dockerfile";
			if (needsStartCmd && !inspection.startCommand) {
				checks.push({
					category: "commands",
					name: "Production Start Command",
					status: "fail",
					message: "No production start command was detected or configured for this backend service.",
					actionableRemediation: "Configure a start command in Application Settings or in hatdot.yaml (run.command).",
				});
			} else {
				checks.push({
					category: "commands",
					name: "Build & Start Commands",
					status: "pass",
					message: `Build: ${inspection.buildCommand || "None (default)"} | Start: ${inspection.startCommand || "Standard container entrypoint"}`,
				});
			}
		} catch (err) {
			checks.push({
				category: "framework",
				name: "Project Inspection",
				status: "warn",
				message: `Source files not yet cloned to local disk: ${err instanceof Error ? err.message : String(err)}. Inspection will run automatically on repository clone.`,
			});
		}
	}

	// 4. Port and Routing Check
	const targetPort = app.ports?.[0]?.targetPort || inspection?.expectedPort || 3000;
	checks.push({
		category: "port_and_routing",
		name: "Port & Ingress Binding",
		status: "pass",
		message: `Traffic will be routed to container port ${targetPort} on interface 0.0.0.0.`,
	});

	// Domain checks
	if (app.domains && app.domains.length > 0) {
		const primaryDomain = app.domains[0]?.host;
		checks.push({
			category: "port_and_routing",
			name: "Domain Association & SSL/TLS",
			status: "pass",
			message: `Primary domain: https://${primaryDomain} (Traefik SSL auto-provisioning enabled).`,
		});
	} else {
		checks.push({
			category: "port_and_routing",
			name: "Domain Association",
			status: "warn",
			message: "No custom domain assigned. Application will be accessible via autogenerated platform subdomain.",
		});
	}

	// 5. Environment & Dependencies Check
	const envText = [app.env, app.environment?.env, app.environment?.project?.env].filter(Boolean).join("\n");
	if (inspection?.djangoSettingsModule && !envText.includes("DJANGO_SETTINGS_MODULE")) {
		checks.push({
			category: "environment",
			name: "Django Settings Module",
			status: "pass",
			message: `Auto-configured DJANGO_SETTINGS_MODULE=${inspection.djangoSettingsModule}`,
		});
	}

	// Calculate overall readiness status
	const hasFail = checks.some((c) => c.status === "fail");
	const hasWarn = checks.some((c) => c.status === "warn");

	let status: ReadinessStatus = "ready_to_build";
	let summary = "All pre-deployment checks passed. The project is ready to build and deploy.";
	let canDeploy = true;

	if (hasFail) {
		canDeploy = false;
		if (!sourceOk) {
			status = "configuration_required";
			summary = "Configuration required: Complete source repository setup before deploying.";
		} else {
			status = "configuration_required";
			summary = "Configuration required: One or more critical build or start settings must be configured.";
		}
	} else if (hasWarn) {
		status = "ready_with_warnings";
		summary = "The project is ready to build, but review the warnings above to ensure expected behavior.";
	}

	const blockingIssues = checks.filter((c) => c.status === "fail").map((c) => c.message);
	const warningsList = checks.filter((c) => c.status === "warn").map((c) => c.message);

	return {
		applicationId: app.applicationId,
		appName: app.appName,
		status,
		summary,
		canDeploy,
		checks,
		blockingIssues,
		warnings: warningsList,
		inspection,
		checkedAt,
	};
};
