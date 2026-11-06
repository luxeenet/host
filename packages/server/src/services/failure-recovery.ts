import {
	DIAGNOSTIC_CATALOG,
	redactSensitiveInformation,
	type DiagnosticCode,
} from "../utils/deployment/diagnostics";
import type { DeploymentPlan } from "../utils/builders/deployment-plan";
import type { HatDotBuilder } from "../utils/builders/hatdot-config";

export interface StructuredFailureDiagnosis {
	code: DiagnosticCode;
	title: string;
	stage: string;
	errorMessage: string;
	likelyCause: string;
	evidence: string;
	recommendedCorrection: string;
	isSafeToAutoRecover: boolean;
	recoveryAction: "retry" | "fallback_builder" | "reconcile_port" | "inject_host" | "manual_fix";
	fallbackBuilder?: HatDotBuilder;
	howToRetry: string;
}

export interface RecoveryAttemptResult {
	attempted: boolean;
	actionTaken?: string;
	nextBuilder?: HatDotBuilder;
	updatedPort?: number;
	reason?: string;
	logMessage: string;
}

/**
 * Intelligent Log Analyzer & Failure Diagnosis Engine.
 * Extracts the root cause from raw build and runtime logs and provides actionable guidance.
 */
export const analyzeBuildFailure = (
	logContent: string,
	plan?: DeploymentPlan | null,
): StructuredFailureDiagnosis => {
	const sanitized = redactSensitiveInformation(logContent || "");
	const lines = sanitized.split("\n");

	// 1. Out of Memory (OOM)
	if (
		/\b(JavaScript heap out of memory|fatal error: runtime: out of memory|OOMKilled|Killed|exit code 137)\b/i.test(
			sanitized,
		)
	) {
		const matchLine = lines.find((l) =>
			/\b(heap out of memory|out of memory|killed|137)\b/i.test(l),
		);
		return {
			code: "UNKNOWN_BUILD_ERROR",
			title: "Out of Memory (OOM) Termination",
			stage: "Stage 3/7: Compilation & Build",
			errorMessage: "Build process was terminated due to exceeding available memory limits (Exit 137 / OOM).",
			likelyCause: "Asset compilation (e.g. Next.js, Vite, Webpack, Rust) consumed more RAM than allocated to the build container.",
			evidence: matchLine?.trim() || "Process killed (exit 137 / Out of memory).",
			recommendedCorrection: "Increase server RAM, enable build swap, or configure NODE_OPTIONS=\"--max-old-space-size=4096\" in Environment Variables.",
			isSafeToAutoRecover: false,
			recoveryAction: "manual_fix",
			howToRetry: "Increase memory resources and click 'Redeploy' from the Deployments tab.",
		};
	}

	// 2. Missing System Dependency / Native C Header
	if (
		/\b(fatal error:\s*([a-zA-Z0-9_./-]+\.h):\s*No such file or directory|gcc: command not found|make: command not found|libpq-dev|libvips-dev|ffmpeg: not found|Package '.*?' has no installation candidate)\b/i.test(
			sanitized,
		)
	) {
		const headerMatch = sanitized.match(
			/fatal error:\s*([a-zA-Z0-9_./-]+\.h):\s*No such file or directory/i,
		);
		const pkg = headerMatch?.[1] ? `system library header (${headerMatch[1]})` : "native system dependency";
		return {
			code: "DEPENDENCY_FAILED",
			title: "Missing System Dependency or Native Compiler Header",
			stage: "Stage 2/7: Dependency Resolution & Native Compilation",
			errorMessage: `A native module compilation failed because a required ${pkg} is not installed in the build environment.`,
			likelyCause: "The application uses native extensions (e.g. Python C-extensions, Node gyp, libvips, psycopg) requiring OS-level apt packages.",
			evidence: lines.find((l) => /fatal error|command not found|cannot find/i.test(l))?.trim() || "Missing native compilation header.",
			recommendedCorrection: "Add the required system package to hatdot.yaml (build.systemPackages: [\"...\"]) or use a custom Dockerfile.",
			isSafeToAutoRecover: false,
			recoveryAction: "manual_fix",
			howToRetry: "Define systemPackages in hatdot.yaml or add a Dockerfile with apt-get install, then redeploy.",
		};
	}

	// 3. Package Manager Lockfile Mismatch / Frozen Lockfile Error
	if (
		/\b(lockfile is out of date|ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile|Your lockfile needs to be updated|Pipfile\.lock out of date)\b/i.test(
			sanitized,
		)
	) {
		return {
			code: "DEPENDENCY_FAILED",
			title: "Lockfile Version Mismatch (Frozen Lockfile Failure)",
			stage: "Stage 2/7: Dependency Resolution",
			errorMessage: "The dependency lockfile does not match the packages declared in package.json / requirements / pyproject.",
			likelyCause: "Dependencies were modified locally without regenerating the corresponding lockfile (pnpm-lock.yaml, yarn.lock, uv.lock, poetry.lock).",
			evidence: lines.find((l) => /out of date|frozen-lockfile|lockfile needs/i.test(l))?.trim() || "Lockfile out of date.",
			recommendedCorrection: "Run your package manager install locally to update the lockfile, commit the change, and push to Git.",
			isSafeToAutoRecover: false,
			recoveryAction: "manual_fix",
			howToRetry: "Commit the updated lockfile and push a new commit or click 'Redeploy'.",
		};
	}

	// 4. Missing Application Entrypoint or Script
	if (
		/\b(npm ERR! missing script:\s*([a-zA-Z0-9_-]+)|Cannot find module\s*['"]([^'"]+)['"]|ModuleNotFoundError:\s*No module named\s*['"]([^'"]+)['"])\b/i.test(
			sanitized,
		)
	) {
		const scriptMatch = sanitized.match(/npm ERR! missing script:\s*([a-zA-Z0-9_-]+)/i);
		const modMatch = sanitized.match(/ModuleNotFoundError:\s*No module named\s*['"]([^'"]+)['"]/i);
		const missing = scriptMatch?.[1] ? `npm script "${scriptMatch[1]}"` : modMatch?.[1] ? `Python module "${modMatch[1]}"` : "required entrypoint";
		return {
			code: "WRONG_START_COMMAND",
			title: "Missing Entrypoint or Build Script",
			stage: "Stage 3/7: Script Execution",
			errorMessage: `Application could not find ${missing}.`,
			likelyCause: "The configured build or start command references a script or file that does not exist in the repository root.",
			evidence: lines.find((l) => /missing script|cannot find module|modulenotfounderror/i.test(l))?.trim() || "Missing script or entrypoint.",
			recommendedCorrection: "Check package.json scripts or Python entrypoint (e.g. wsgi.py / main.py), or configure explicit commands in hatdot.yaml.",
			isSafeToAutoRecover: false,
			recoveryAction: "manual_fix",
			howToRetry: "Configure the correct startCommand or buildCommand in hatdot.yaml or Application Settings.",
		};
	}

	// 5. Host Validation Rejection (e.g. Vite 403, Django DisallowedHost)
	if (
		/\b(Host not allowed|DisallowedHost|Blocked host|Invalid Host header|403 Forbidden.*host|Host .* is not allowed)\b/i.test(
			sanitized,
		)
	) {
		return {
			code: "HOST_VALIDATION_BLOCKED",
			title: "Framework Host Header Rejection",
			stage: "Stage 7/7: Public Reachability",
			errorMessage: "Framework host validation rejected the assigned HatDot domain name.",
			likelyCause: "The framework (Vite, Django, Rails) strictly checks incoming HTTP Host headers and the assigned domain was not in its whitelist.",
			evidence: lines.find((l) => /host not allowed|disallowedhost|blocked host|403 forbidden/i.test(l))?.trim() || "Host header rejected by framework.",
			recommendedCorrection: "Add the assigned domain to your framework configuration (e.g. preview.allowedHosts in vite.config.js, or ALLOWED_HOSTS in Django).",
			isSafeToAutoRecover: true,
			recoveryAction: "inject_host",
			howToRetry: "HatDot will auto-configure allowed hosts on the next deployment run.",
		};
	}

	// 6. Port Mismatch / Container Running with Unreachable Port
	const portInLog = sanitized.match(/listening on (?:port\s*|http:\/\/[^:]+:)\s*(\d+)/i);
	const targetPortVal = plan ? ((plan as any).targetPort ?? (plan as any).port?.value) : undefined;
	if (
		/\b(HTTP 502 Bad Gateway|HTTP 504 Gateway Timeout|Upstream Unreachable|container is running but upstream port is unreachable)\b/i.test(
			sanitized,
		) ||
		(portInLog && targetPortVal && Number(targetPortVal) !== Number(portInLog[1]))
	) {
		const discoveredPort = portInLog?.[1] ? Number.parseInt(portInLog[1], 10) : undefined;

		return {
			code: "PORT_MISMATCH",
			title: "Port Mismatch / Upstream Unreachable",
			stage: "Stage 7/7: Upstream Ingress Verification",
			errorMessage: "The container is running in Docker Swarm, but the reverse proxy received HTTP 502/504 connecting to the upstream port.",
			likelyCause: discoveredPort
				? `The application started listening on port ${discoveredPort}, but HatDot was configured to route traffic to port ${targetPortVal || "different port"}.`
				: "The application failed to bind to 0.0.0.0, or is listening on a different port than configured in Application Settings.",
			evidence: lines.find((l) => /502|504|upstream port is unreachable|listening on port/i.test(l))?.trim() || "HTTP 502 Bad Gateway from reverse proxy.",
			recommendedCorrection: discoveredPort
				? `Update Target Port in Application Settings to ${discoveredPort}.`
				: "Ensure your server binds to 0.0.0.0 and configure Target Port in Application Settings to match your application's listening port.",
			isSafeToAutoRecover: Boolean(discoveredPort),
			recoveryAction: discoveredPort ? "reconcile_port" : "manual_fix",
			howToRetry: "Update the Target Port in Application Settings to match your server port and redeploy.",
		};
	}

	// 7. Database Connectivity Failure
	if (
		/\b(psycopg2\.OperationalError|password authentication failed|connection to server at .* failed|MongoServerSelectionError|Redis connection to .* failed|ECONNREFUSED.*(?:5432|3306|27017|6379)|connect ECONNREFUSED|connection refused)\b/i.test(
			sanitized,
		)
	) {
		return {
			code: "DATABASE_CONNECTION_REFUSED",
			title: "Database Connectivity Failure",
			stage: "Stage 5/7: Database Connection & Migrations",
			errorMessage: "Application failed to connect to the configured database or cache service.",
			likelyCause: "Database credentials (DATABASE_URL / DB_HOST / DB_PASSWORD) are incorrect or the database instance is unreachable.",
			evidence: lines.find((l) => /operationalerror|authentication failed|connection.*failed|econnrefused|connection refused/i.test(l))?.trim() || "Database connection refused.",
			recommendedCorrection: "Verify DATABASE_URL or database credentials in Environment Variables, and ensure the database container is healthy.",
			isSafeToAutoRecover: false,
			recoveryAction: "manual_fix",
			howToRetry: "Update database credentials in Application Environment and click 'Redeploy'.",
		};
	}

	// 8. Railpack / Buildpack Builder Failure with Safe Fallback
	if (
		(plan?.builder === "railpack" || /\brailpack\b/i.test(sanitized)) &&
		/\b(railpack prepare failed|BUILDKIT_SYNTAX|railpack-frontend|failed to solve with frontend|railpack build failed|unsupported configuration directive in railpack manifest)\b/i.test(
			sanitized,
		)
	) {
		return {
			code: "BUILD_SYNTAX_ERROR",
			title: "Railpack Builder Execution Failure",
			stage: "Stage 3/7: Railpack Image Build",
			errorMessage: "Railpack encountered an error preparing or compiling the application image.",
			likelyCause: "Project structure or dependencies are better suited for Nixpacks multi-runtime compilation.",
			evidence: lines.find((l) => /railpack|buildkit/i.test(l))?.trim() || "Railpack build error.",
			recommendedCorrection: "Switch builder to Nixpacks in Application Settings or hatdot.yaml.",
			isSafeToAutoRecover: true,
			recoveryAction: "fallback_builder",
			fallbackBuilder: "nixpacks",
			howToRetry: "HatDot can automatically retry this build using the Nixpacks builder.",
		};
	}

	// Default Generic Failure
	const lastErrorLine = [...lines].reverse().find((l) =>
		/\b(error|failed|fatal|exception)\b/i.test(l) && !/npm fund|warning|notice/i.test(l),
	);

	return {
		code: "UNKNOWN_BUILD_ERROR",
		title: "Build or Deployment Execution Failure",
		stage: "Stage 3/7: Build Execution",
		errorMessage: lastErrorLine?.trim() || "Build command exited with non-zero exit code.",
		likelyCause: "Command exited with an error. Review the build output log for stack traces.",
		evidence: lastErrorLine?.trim() || "Command exited with error status.",
		recommendedCorrection: "Inspect the deployment log above for specific compiler, linter, or script errors.",
		isSafeToAutoRecover: false,
		recoveryAction: "manual_fix",
		howToRetry: "Fix the indicated error in source code or configuration and redeploy.",
	};
};

/**
 * Executes a controlled, automated recovery action if safe to do so.
 * Enforces strict safety rules:
 * - Max 2 recovery attempts per application deployment.
 * - Never mutates customer source code or removes dependencies.
 * - Never downgrades security checks or exposes secrets.
 */
export const executeControlledRecovery = async (params: {
	applicationId: string;
	appName: string;
	currentBuilder: HatDotBuilder | string;
	diagnosis: StructuredFailureDiagnosis;
	recoveryAttemptCount: number;
	maxAttempts?: number;
}): Promise<RecoveryAttemptResult> => {
	const {
		appName,
		currentBuilder,
		diagnosis,
		recoveryAttemptCount,
		maxAttempts = 2,
	} = params;

	if (recoveryAttemptCount >= maxAttempts) {
		return {
			attempted: false,
			reason: `Maximum automated recovery attempts (${maxAttempts}) reached. Manual developer action required.`,
			logMessage: `[Recovery] Max automatic recovery attempts (${maxAttempts}) reached for ${appName}. Aborting automated recovery to avoid deployment loops.`,
		};
	}

	if (!diagnosis.isSafeToAutoRecover) {
		return {
			attempted: false,
			reason: `Automatic recovery is unsafe for failure code ${diagnosis.code}.`,
			logMessage: `[Recovery] Automatic recovery skipped: ${diagnosis.likelyCause}. Developer intervention required.`,
		};
	}

	// Case A: Fallback between compatible builders (e.g. Railpack -> Nixpacks)
	if (diagnosis.recoveryAction === "fallback_builder" && diagnosis.fallbackBuilder) {
		const nextBuilder = diagnosis.fallbackBuilder;
		if (nextBuilder !== currentBuilder) {
			return {
				attempted: true,
				actionTaken: `Switched builder from ${currentBuilder} to ${nextBuilder}`,
				nextBuilder,
				logMessage: `[Recovery] 🔄 Safe Builder Fallback: Railpack compilation failed. Automatically retrying deployment with Nixpacks builder for ${appName}...`,
			};
		}
	}

	// Case B: Port Reconciliation
	if (diagnosis.recoveryAction === "reconcile_port") {
		const portMatch = diagnosis.evidence.match(/port\s*(\d+)/i);
		const newPort = portMatch?.[1] ? Number.parseInt(portMatch[1], 10) : undefined;
		if (newPort && newPort > 0 && newPort <= 65535) {
			return {
				attempted: true,
				actionTaken: `Reconciled target port to ${newPort}`,
				updatedPort: newPort,
				logMessage: `[Recovery] 🔄 Port Auto-Reconciliation: Detected application listening on port ${newPort}. Updating platform routing configuration and retrying...`,
			};
		}
	}

	// Case C: Host Validation Injection
	if (diagnosis.recoveryAction === "inject_host") {
		return {
			attempted: true,
			actionTaken: "Injected authorized framework host header",
			logMessage: `[Recovery] 🔄 Host Validation Reconciliation: Auto-injecting authorized platform host into framework preview configuration...`,
		};
	}

	return {
		attempted: false,
		reason: "No automated recovery rule matched the diagnosed failure.",
		logMessage: `[Recovery] No automated recovery available for ${diagnosis.code}.`,
	};
};

/**
 * Formats a structured diagnostic report suitable for appending to build/deployment logs.
 */
export const formatFailureDiagnosisReport = (
	diagnosis: StructuredFailureDiagnosis,
	recoveryResult?: RecoveryAttemptResult,
): string => {
	let out = "\n================================================================================\n";
	out += `❌ Build & Deployment Failure Diagnosis [${diagnosis.code}]\n`;
	out += "================================================================================\n";
	out += `Issue:          ${diagnosis.title}\n`;
	out += `Pipeline Stage: ${diagnosis.stage}\n`;
	out += `Likely Cause:   ${diagnosis.likelyCause}\n\n`;
	out += `Evidence:\n  ${diagnosis.evidence}\n\n`;
	out += `Actionable Remediation:\n  ${diagnosis.recommendedCorrection}\n\n`;
	if (recoveryResult?.attempted) {
		out += `Automated Recovery: Attempted - ${recoveryResult.actionTaken}\n`;
	} else if (recoveryResult?.reason) {
		out += `Automated Recovery: Skipped (${recoveryResult.reason})\n`;
	} else {
		out += `Automated Recovery: Not applicable for this error type\n`;
	}
	out += `\nHow to Retry:\n  ${diagnosis.howToRetry}\n`;
	out += "================================================================================\n";
	return out;
};

