import os from "node:os";
import { findApplicationById } from "./application";
import { findDomainsByApplicationId, validateDomain } from "./domain";
import { inspectApplication } from "./app-detector";

export interface PreflightItem {
	id: string;
	title: string;
	status: "pass" | "warn" | "fail";
	summary: string;
	detail?: string;
	fixSuggestion?: string;
}

export interface PreflightReport {
	ready: boolean;
	items: PreflightItem[];
	summary: string;
	detectedPort?: number;
	detectedFramework?: string;
}

/**
 * Runs a comprehensive pre-flight deployment readiness check before building or deploying.
 * Returns human-friendly diagnostics and fix suggestions.
 */
export const runPreflightCheck = async (
	applicationId: string,
): Promise<PreflightReport> => {
	const items: PreflightItem[] = [];
	const app = await findApplicationById(applicationId);
	const domains = await findDomainsByApplicationId(applicationId);

	// 1. Source check
	if (app.sourceType === "github" || app.sourceType === "gitlab" || app.sourceType === "bitbucket" || app.sourceType === "gitea" || app.sourceType === "git") {
		if (!app.repository && !app.customGitUrl) {
			items.push({
				id: "source-repo",
				title: "Source Repository",
				status: "fail",
				summary: "No source repository has been connected.",
				fixSuggestion: "Select a repository and branch in the Source tab before deploying.",
			});
		} else {
			items.push({
				id: "source-repo",
				title: "Source Repository",
				status: "pass",
				summary: `Connected to repository (${app.repository || app.customGitUrl}) on branch "${app.branch || "main"}".`,
			});
		}
	} else if (app.sourceType === "docker") {
		if (!app.dockerImage) {
			items.push({
				id: "source-docker",
				title: "Docker Image",
				status: "fail",
				summary: "No Docker image name specified.",
				fixSuggestion: "Enter the Docker image name (e.g. nginx:alpine) in the Source settings.",
			});
		} else {
			items.push({
				id: "source-docker",
				title: "Docker Image",
				status: "pass",
				summary: `Using Docker image: ${app.dockerImage}`,
			});
		}
	} else if (app.sourceType === "drop") {
		items.push({
			id: "source-drop",
			title: "Source Archive",
			status: "pass",
			summary: "Using uploaded project files.",
		});
	}

	// 2. Application & Framework Detection
	let inspectionResult: Awaited<ReturnType<typeof inspectApplication>> | null = null;
	try {
		inspectionResult = await inspectApplication(applicationId);
		items.push({
			id: "framework-detection",
			title: "Application Framework",
			status: "pass",
			summary: `Detected: ${inspectionResult.detected.framework} (${inspectionResult.detected.language})`,
			detail: inspectionResult.detected.reason,
		});
	} catch {
		items.push({
			id: "framework-detection",
			title: "Application Framework",
			status: "warn",
			summary: "Automatic framework detection will run during the build step.",
		});
	}

	// 3. Build Configuration
	const buildType = app.buildType || "nixpacks";
	if (buildType === "dockerfile" && app.dockerfile && !app.dockerfile.endsWith("Dockerfile")) {
		items.push({
			id: "build-config",
			title: "Build Configuration",
			status: "warn",
			summary: `Custom Dockerfile path configured: ${app.dockerfile}`,
			fixSuggestion: "Ensure the custom Dockerfile exists at this relative path in your repository.",
		});
	} else {
		items.push({
			id: "build-config",
			title: "Build Configuration",
			status: "pass",
			summary: `Build method configured: ${buildType.toUpperCase()}`,
		});
	}

	// 4. Server Resources
	const totalMemBytes = os.totalmem();
	const freeMemBytes = os.freemem();
	const freeMemMb = Math.round(freeMemBytes / (1024 * 1024));
	const totalMemMb = Math.round(totalMemBytes / (1024 * 1024));

	if (freeMemMb < 256) {
		items.push({
			id: "server-resources",
			title: "Server Memory",
			status: "warn",
			summary: `Available memory is low: ${freeMemMb} MB free of ${totalMemMb} MB.`,
			fixSuggestion: "Compiling large frameworks like Next.js may be slow or trigger out-of-memory errors.",
		});
	} else {
		items.push({
			id: "server-resources",
			title: "Server Memory",
			status: "pass",
			summary: `Sufficient memory available: ${freeMemMb} MB free.`,
		});
	}

	// 5. Port Configuration
	const detectedPort = inspectionResult?.detected.suggestedPort || 3000;
	if (domains.length > 0) {
		for (const d of domains) {
			if (!d.port || d.port < 1 || d.port > 65535) {
				items.push({
					id: `port-${d.domainId}`,
					title: `Port for ${d.host}`,
					status: "fail",
					summary: `Invalid container port (${d.port}) configured for domain ${d.host}.`,
					fixSuggestion: `Change the port to ${detectedPort} in Domain settings.`,
				});
			} else {
				items.push({
					id: `port-${d.domainId}`,
					title: `Port for ${d.host}`,
					status: "pass",
					summary: `Routing to internal container port ${d.port}.`,
				});
			}
		}
	} else {
		items.push({
			id: "port-check",
			title: "Internal Container Port",
			status: "pass",
			summary: `Default internal port will be ${detectedPort}.`,
		});
	}

	// 6. Domain DNS readiness check
	if (domains.length > 0) {
		for (const d of domains) {
			if (d.host.includes(".traefik.me") || d.host.includes(".sslip.io") || d.host.includes("localhost")) {
				items.push({
					id: `dns-${d.domainId}`,
					title: `Domain DNS (${d.host})`,
					status: "pass",
					summary: "Automatic development / wildcard domain configured.",
				});
			} else {
				const dnsCheck = await validateDomain(d.host).catch(() => ({ isValid: false, resolvedIp: undefined }));
				if (dnsCheck.isValid) {
					items.push({
						id: `dns-${d.domainId}`,
						title: `Domain DNS (${d.host})`,
						status: "pass",
						summary: `DNS resolved to ${dnsCheck.resolvedIp || "server IP"}.`,
					});
				} else {
					items.push({
						id: `dns-${d.domainId}`,
						title: `Domain DNS (${d.host})`,
						status: "warn",
						summary: `Domain ${d.host} does not yet point to this server's IP address.`,
						fixSuggestion: "Add an A record in your DNS manager pointing to your server's public IP address.",
					});
				}
			}
		}
	}

	const hasFailure = items.some((i) => i.status === "fail");
	const hasWarnings = items.some((i) => i.status === "warn");

	let summary = "Ready for deployment.";
	if (hasFailure) {
		summary = "Configuration needs attention before deploying.";
	} else if (hasWarnings) {
		summary = "Ready to deploy with minor warnings.";
	}

	return {
		ready: !hasFailure,
		items,
		summary,
		detectedPort,
		detectedFramework: inspectionResult?.detected.framework,
	};
};
