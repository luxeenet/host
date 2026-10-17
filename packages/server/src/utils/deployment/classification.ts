/**
 * Centralized Deployment Event Severity & Warning Classification System for HatDot.
 *
 * Implements the structured severity model:
 * - "info": Informational output (e.g. packages looking for funding, standard build progress).
 * - "warning": Non-fatal issue with useful context (e.g. dependency audit vulnerabilities,
 *              Docker secret-handling warnings, transient HTTP 502 during warmup).
 * - "error": Required build, startup, readiness, routing, or connectivity operation failed.
 * - "success": Required checks completed successfully.
 */

export type DeploymentSeverity = "info" | "warning" | "error" | "success";

export type DeploymentEventCategory =
	| "build"
	| "security"
	| "readiness"
	| "routing"
	| "database"
	| "system";

export interface DeploymentEvent {
	severity: DeploymentSeverity;
	category: DeploymentEventCategory;
	code?: string;
	message: string;
	details?: string;
	remediation?: string;
	timestamp: string;
}

export interface ClassifiedLogLine {
	severity: DeploymentSeverity;
	category: DeploymentEventCategory;
	isSecurityWarning: boolean;
	isInformational: boolean;
	isTransientWarmup: boolean;
	remediation?: string;
}

// Patterns that are strictly INFORMATIONAL and must never fail builds or be treated as errors
const INFORMATIONAL_PATTERNS = [
	/\b\d+\s+packages?\s+(?:are\s+)?looking\s+for\s+funding\b/i,
	/\brun\s+`?npm\s+fund`?\s+(?:for\s+details)?/i,
	/\bnpm\s+notice\b/i,
	/\b\[notice\]\s+a\s+new\s+release\s+of\s+pip\s+is\s+available\b/i,
	/\bpip\s+notice\b/i,
	/\bcomposer\s+notice\b/i,
	/\bup\s+to\s+date\s+in\s+\d+/i,
	/\badded\s+\d+\s+packages?\b/i,
	/\baudited\s+\d+\s+packages?\b/i,
	/\bstage\s+\d+\/\d+:/i,
	/\bstep\s+\d+\/\d+:/i,
];

// Patterns that are SECURITY or BUILD WARNINGS (non-fatal context, must remain visible as warnings)
const SECURITY_WARNING_PATTERNS = [
	{
		pattern: /\bSecretsUsedInArgOrEnv\b/i,
		remediation:
			"BuildKit Security Warning: Avoid passing sensitive credentials in ARG or ENV instructions. Use Docker build secrets (--secret) instead.",
	},
	{
		pattern:
			/\bSensitive\s+data\s+should\s+not\s+be\s+used\s+in\s+['"]?(?:ENV|ARG)['"]?/i,
		remediation:
			"BuildKit Security Warning: Do not use ARG or ENV instructions for secrets. Use Docker build secrets to prevent leaking credentials in image metadata.",
	},
	{
		pattern: /\bfound\s+\d+\s+vulnerabilit(?:y|ies)\b/i,
		remediation:
			"Dependency Security Notice: Review reported package vulnerabilities. Run 'npm audit' or update dependencies to patch known advisories.",
	},
	{
		pattern: /\bnpm\s+audit\s+(?:reports|found|detected)\s+vulnerabilit/i,
		remediation:
			"Dependency Security Notice: Vulnerabilities detected in project dependencies. Use 'npm audit fix' or update affected packages.",
	},
	{
		pattern: /\brun\s+`?npm\s+audit`?\s+(?:for\s+details|to\s+fix)?/i,
		remediation:
			"Run 'npm audit' in your local environment to inspect dependency advisory details and remediation steps.",
	},
];

const GENERAL_WARNING_PATTERNS = [
	/\bnpm\s+warn(?:ing)?\b/i,
	/\b\[warn(?:ing)?\]/i,
	/\bwarning:\s+/i,
	/\bdeprecated\b/i,
	/\bone\s+or\s+more\s+build-args\s+\[.*?\]\s+were\s+not\s+consumed\b/i,
	/\btransient\s+http\s+502\b/i,
	/\bcontainer\s+warmup\b/i,
	/\bwaiting\s+for\s+(?:service|container|upstream)\s+warmup\b/i,
	/\bhttps\s+certificate\s+(?:verification\s+pending|provisioning\s+in\s+progress)\b/i,
];

// Patterns that indicate GENUINE FATAL ERRORS
const FATAL_ERROR_PATTERNS = [
	/\bcommand\s+execution\s+failed\b/i,
	/\bcontainer\s+(?:crashed|failed\s+to\s+start|terminated)\b/i,
	/\bprocess\s+exited\s+with\s+code\s+[1-9]\d*\b/i,
	/\bpersistent\s+http\s+(?:502|504)\b/i,
	/\bhttp\s+(?:502|504)\s+bad\s+gateway:\s+upstream\s+unreachable\b/i,
	/\bhost\s+validation\s+(?:rejected|blocked)\b/i,
	/\bcannot\s+find\s+(?:package|module)\b/i,
	/\berr_module_not_found\b/i,
	/\bunhandled\s+(?:rejection|exception)\b/i,
	/\buncaught\s+exception\b/i,
	/\bfailed\s+to\s+load\s+config\b/i,
	/\bbuild\s+failed\b/i,
];

// Patterns that indicate SUCCESS
const SUCCESS_PATTERNS = [
	/\b(?:image\s+)?packaged\s+successfully\b/i,
	/\bdeployment\s+completed\s+successfully\b/i,
	/\bverified\s+live\b/i,
	/\bcontainer\s+running\s+and\s+task\s+converged\b/i,
	/\bpublic\s+url\s+reachability:\s+verified\s+live\b/i,
	/\bapplication\s+is\s+live\s+and\s+accessible\b/i,
	/\b✓\s+container\s+running\b/i,
];

/**
 * Classifies a single line of log text according to the HatDot structured severity model.
 * Prioritizes known non-fatal informational and security warning patterns over generic error strings.
 */
export const classifyLogLine = (line: string): ClassifiedLogLine => {
	const trimmed = line.trim();
	if (!trimmed) {
		return {
			severity: "info",
			category: "build",
			isSecurityWarning: false,
			isInformational: true,
			isTransientWarmup: false,
		};
	}

	// 1. Explicit Informational Patterns (Funding, notices, stage transitions)
	for (const pattern of INFORMATIONAL_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				severity: "info",
				category: "build",
				isSecurityWarning: false,
				isInformational: true,
				isTransientWarmup: false,
			};
		}
	}

	// 2. Security Warnings (Vulnerabilities, SecretsUsedInArgOrEnv)
	for (const sec of SECURITY_WARNING_PATTERNS) {
		if (sec.pattern.test(trimmed)) {
			return {
				severity: "warning",
				category: "security",
				isSecurityWarning: true,
				isInformational: false,
				isTransientWarmup: false,
				remediation: sec.remediation,
			};
		}
	}

	// 3. Transient Readiness / Warmup Warnings
	if (
		/\btransient\s+http\s+502\b/i.test(trimmed) ||
		/\bcontainer\s+warmup\b/i.test(trimmed) ||
		/\binitial\s+probe.*?warmup\b/i.test(trimmed)
	) {
		return {
			severity: "warning",
			category: "readiness",
			isSecurityWarning: false,
			isInformational: false,
			isTransientWarmup: true,
			remediation:
				"The container required warm-up time before accepting HTTP connections. The service successfully converged.",
		};
	}

	// 4. General Build & Optimization Warnings
	for (const pattern of GENERAL_WARNING_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				severity: "warning",
				category: "build",
				isSecurityWarning: false,
				isInformational: false,
				isTransientWarmup: false,
			};
		}
	}

	// 5. Genuine Fatal Errors
	for (const pattern of FATAL_ERROR_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				severity: "error",
				category: /\b(?:502|504|upstream|readiness|routing)\b/i.test(trimmed)
					? "routing"
					: "build",
				isSecurityWarning: false,
				isInformational: false,
				isTransientWarmup: false,
			};
		}
	}

	// 6. Success Events
	for (const pattern of SUCCESS_PATTERNS) {
		if (pattern.test(trimmed)) {
			return {
				severity: "success",
				category: "readiness",
				isSecurityWarning: false,
				isInformational: false,
				isTransientWarmup: false,
			};
		}
	}

	// Default to info for ordinary build, compilation, or runtime stdout
	return {
		severity: "info",
		category: "build",
		isSecurityWarning: false,
		isInformational: true,
		isTransientWarmup: false,
	};
};

/**
 * Evaluates whether a set of build or readiness conditions constitutes a successful deployment
 * versus a genuine deployment failure, ensuring non-fatal warnings never fail the build.
 */
export const evaluateDeploymentOutcome = (params: {
	buildExitCode: number;
	isHttpWorkload: boolean;
	isContainerRunning: boolean;
	isUrlResponding?: boolean;
	hasTransientWarmup?: boolean;
	hasSecurityWarnings?: boolean;
	hasFundingNotices?: boolean;
}): {
	status: "done" | "error";
	severity: DeploymentSeverity;
	message: string;
	diagnosticNotice?: string;
} => {
	// A non-zero build exit code is always a fatal build error
	if (params.buildExitCode !== 0) {
		return {
			status: "error",
			severity: "error",
			message: `Build process failed with exit code ${params.buildExitCode}.`,
			diagnosticNotice:
				"Inspect build logs above to identify syntax errors, missing packages, or failed compile steps.",
		};
	}

	// The container must be running in Docker Swarm
	if (!params.isContainerRunning) {
		return {
			status: "error",
			severity: "error",
			message: "Container task failed to converge or exited prematurely.",
			diagnosticNotice:
				"The container process crashed during startup. Check Application Logs for runtime stack traces.",
		};
	}

	// Background workers (non-HTTP) succeed if the process is running, regardless of HTTP probes
	if (!params.isHttpWorkload) {
		return {
			status: "done",
			severity: params.hasSecurityWarnings ? "warning" : "success",
			message: "Background worker service converged and is running normally.",
			diagnosticNotice: params.hasSecurityWarnings
				? "Deployment succeeded with non-fatal security or dependency advisories."
				: undefined,
		};
	}

	// For HTTP workloads, the public URL must become reachable before the deadline
	if (!params.isUrlResponding) {
		return {
			status: "error",
			severity: "error",
			message:
				"Persistent HTTP 502 Bad Gateway: Application container is running but upstream port is unreachable after readiness deadline.",
			diagnosticNotice:
				"Verify that your application binds to 0.0.0.0 and listens on the expected port.",
		};
	}

	// HTTP workload is live and responding!
	if (params.hasTransientWarmup) {
		return {
			status: "done",
			severity: "warning",
			message:
				"Application deployed successfully. Initial probe received transient HTTP 502 during container warmup before recovering.",
			diagnosticNotice:
				"Notice: Container cold start took longer than initial probe timeout. Consider optimizing initial initialization.",
		};
	}

	return {
		status: "done",
		severity: params.hasSecurityWarnings ? "warning" : "success",
		message: "Application deployed successfully and verified live.",
		diagnosticNotice: params.hasSecurityWarnings
			? "Non-fatal dependency warnings were detected during build (see logs)."
			: undefined,
	};
};
