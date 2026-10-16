import {
	type DiagnosticCode,
	DIAGNOSTIC_CATALOG,
	redactSensitiveInformation,
} from "./diagnostics";

export type DeploymentAudience = "admin" | "customer";

export type DeploymentStageName =
	| "Stage 1/7: Configuration & Framework Detection"
	| "Stage 2/7: Source Checkout & Verification"
	| "Stage 3/7: Dependency Resolution"
	| "Stage 4/7: Image Packaging"
	| "Stage 5/7: Container Startup & Orchestration"
	| "Stage 6/7: Application Health & Readiness Convergence"
	| "Stage 7/7: Public URL & Upstream Reachability Verification";

export interface DeploymentDiagnosticEvent {
	deploymentId: string;
	applicationId: string;
	tenantId?: string;
	stage: string;
	stageName: string;
	status: "pending" | "running" | "success" | "warning" | "error";
	diagnosticCode?: DiagnosticCode;
	customerMessage: string;
	progressPercent?: number;
	recommendedAction?: string;
	timestamp: string;
	technicalContext?: Record<string, unknown>; // Admin only
}

export const CUSTOMER_STAGE_PROGRESS: Record<
	string,
	{ customerMessage: string; progressPercent: number }
> = {
	"1": {
		customerMessage: "Preparing your application and analyzing framework requirements...",
		progressPercent: 15,
	},
	"2": {
		customerMessage: "Verifying project repository and source code...",
		progressPercent: 30,
	},
	"3": {
		customerMessage: "Installing project dependencies and platform-compatible packages...",
		progressPercent: 45,
	},
	"4": {
		customerMessage: "Building your production application and compiling static assets...",
		progressPercent: 65,
	},
	"5": {
		customerMessage: "Starting your application container in high-availability mode...",
		progressPercent: 80,
	},
	"6": {
		customerMessage: "Checking application readiness and health endpoints...",
		progressPercent: 90,
	},
	"7": {
		customerMessage: "Configuring public domain routing and verifying secure HTTPS access...",
		progressPercent: 95,
	},
	ready: {
		customerMessage: "Your application is ready and publicly accessible.",
		progressPercent: 100,
	},
};

/**
 * Layer 1: Pre-persistence sanitization.
 * Scrubs all passwords, tokens, API keys, private keys, database credentials,
 * and sensitive environment variables BEFORE logs are written to disk.
 */
export const sanitizeLogContent = (rawText: string): string => {
	if (!rawText) return "";
	return redactSensitiveInformation(rawText);
};

// Internal infrastructure and Docker patterns to strip for customer view
const INTERNAL_DOCKER_CMD_PATTERN = /^\s*(?:docker\s+(?:service|build|run|exec|inspect|pull|login|network|system|swarm|stack|volume)\b.*$)/gim;
const INTERNAL_DOCKER_TASK_PATTERN = /\b(?:docker swarm task|task [a-z0-9]{10,}|replica [0-9]+\/[0-9]+|converged in docker swarm)\b/gi;
const INTERNAL_NIXPACKS_SCRIPT_PATTERN = /^\s*(?:export\s+NIXPACKS_[A-Z_]+=|eval\s+["']?\$|case\s+"\$ARCH"|NATIVE_REPAIR=).*$/gim;
const INTERNAL_IMAGE_REF_PATTERN = /\b(?:sha256:[a-f0-9]{64}|(?:localhost:\d+|dokploy|registry\.[a-z0-9.-]+)\/[a-z0-9._-]+:[a-z0-9._-]+)\b/gi;
const INTERNAL_CONTAINER_ID_PATTERN = /\b(?:container id:?\s*|task id:?\s*)[a-f0-9]{12,64}\b/gi;
const INTERNAL_FILESYSTEM_PATH_PATTERN = /(?:\/etc\/dokploy|\/var\/run\/docker\.sock|\/nix\/store\/[a-z0-9]+-[^\s/]+|\/root\/\.nix[^\s]*)/g;
const INTERNAL_OVERLAY_NETWORK_PATTERN = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|dokploy-network|traefik_default)\b/g;
const RAW_STACK_TRACE_LINE = /^\s*at\s+.*$/gm;

/**
 * Layer 2: Audience-aware transformation boundary.
 *
 * - Admin audience: Receives technical diagnostics, build commands, exit codes,
 *   compilation output, and health probe metrics (with secrets pre-redacted).
 * - Customer audience: Receives a clean, brand-safe progress stream, public URLs,
 *   framework details, compilation errors in customer files, and actionable
 *   remediations from the diagnostic catalog. Internal paths, Docker orchestration,
 *   raw Nixpacks bash scripts, internal network topology, and raw V8 stack traces
 *   are strictly removed.
 */
export const transformLogForAudience = (
	rawLog: string,
	audience: DeploymentAudience = "customer",
): string => {
	if (!rawLog) return "";

	// Always ensure secrets are redacted
	const baseSanitized = sanitizeLogContent(rawLog);

	if (audience === "admin") {
		return baseSanitized;
	}

	// Customer transformation
	let customerLog = baseSanitized;

	// 1. Remove raw Docker CLI commands
	customerLog = customerLog.replace(INTERNAL_DOCKER_CMD_PATTERN, "");

	// 2. Remove raw Nixpacks preflight shell scripts & internal exports
	customerLog = customerLog.replace(INTERNAL_NIXPACKS_SCRIPT_PATTERN, "");

	// 3. Remove raw Docker Swarm orchestration details and task hashes
	customerLog = customerLog.replace(INTERNAL_DOCKER_TASK_PATTERN, "");

	// 4. Strip internal image references and sha256 digests
	customerLog = customerLog.replace(INTERNAL_IMAGE_REF_PATTERN, "[image]");

	// 5. Strip container and task IDs
	customerLog = customerLog.replace(INTERNAL_CONTAINER_ID_PATTERN, "");

	// 6. Strip internal server filesystem paths (/etc/dokploy, /nix/store/..., /var/run/...)
	customerLog = customerLog.replace(INTERNAL_FILESYSTEM_PATH_PATTERN, "");

	// 7. Strip internal private overlay IP ranges and internal network names
	customerLog = customerLog.replace(INTERNAL_OVERLAY_NETWORK_PATTERN, "[internal-network]");

	// 8. Strip raw stack traces
	customerLog = customerLog.replace(RAW_STACK_TRACE_LINE, "");

	// 9. Standardize stage titles into customer-friendly headings
	customerLog = customerLog
		.replace(/Stage 1\/7:.*$/gm, "─── Step 1/7: Preparing Application & Detecting Framework ───")
		.replace(/Stage 2\/7:.*$/gm, "─── Step 2/7: Fetching Repository Code ───")
		.replace(/Stage 3\/7:.*$/gm, "─── Step 3/7: Installing Project Dependencies ───")
		.replace(/Stage 4\/7:.*$/gm, "─── Step 4/7: Building Production Application ───")
		.replace(/Stage 5\/7:.*$/gm, "─── Step 5/7: Starting Application ───")
		.replace(/Stage 6\/7:.*$/gm, "─── Step 6/7: Checking Application Readiness ───")
		.replace(/Stage 7\/7:.*$/gm, "─── Step 7/7: Verifying Public Domain & HTTPS ───");

	// 10. Clean up multiple empty lines
	customerLog = customerLog.replace(/\n{3,}/g, "\n\n").trim();

	// 11. Handle unknown or unclassified fatal exceptions safely
	if (customerLog.includes("Error occurred ❌, check the logs for details.") && customerLog.length < 150) {
		customerLog += `\n\nBuild encountered an error. If your build failed, verify that your build script generates the expected output directory and that all dependencies are specified in your package manifest.`;
	}

	return customerLog;
};

/**
 * Transforms an individual streaming log chunk for WebSocket clients.
 */
export const transformChunkForAudience = (
	chunk: string,
	audience: DeploymentAudience = "customer",
): string => {
	if (!chunk) return "";
	return transformLogForAudience(chunk, audience);
};

/**
 * Checks whether an authenticated user has administrative privileges.
 */
export const isUserAdmin = (user: {
	role?: string | null;
	isPlatformAdmin?: boolean | null;
} | null | undefined): boolean => {
	if (!user) return false;
	if (user.isPlatformAdmin) return true;
	return user.role === "admin" || user.role === "owner";
};

/**
 * Formats a typed customer-facing diagnostic event.
 */
export const createDiagnosticEvent = (params: {
	deploymentId: string;
	applicationId: string;
	tenantId?: string;
	stageNum: string;
	status: DeploymentDiagnosticEvent["status"];
	diagnosticCode?: DiagnosticCode;
	customMessage?: string;
	technicalDetails?: Record<string, unknown>;
}): DeploymentDiagnosticEvent => {
	const stageInfo = CUSTOMER_STAGE_PROGRESS[params.stageNum] || {
		customerMessage: params.customMessage || "Processing application deployment...",
		progressPercent: 50,
	};

	const diagInfo = params.diagnosticCode
		? DIAGNOSTIC_CATALOG[params.diagnosticCode]
		: undefined;

	return {
		deploymentId: params.deploymentId,
		applicationId: params.applicationId,
		tenantId: params.tenantId,
		stage: `Stage ${params.stageNum}/7`,
		stageName: stageInfo.customerMessage,
		status: params.status,
		diagnosticCode: params.diagnosticCode,
		customerMessage: diagInfo?.explanation || params.customMessage || stageInfo.customerMessage,
		progressPercent: stageInfo.progressPercent,
		recommendedAction: diagInfo?.remediation,
		timestamp: new Date().toISOString(),
		technicalContext: params.technicalDetails,
	};
};
