/**
 * Standardized Diagnostic Codes and Deployment Status Lifecycle for HatDot.
 * Every failure code maps to a precise root cause and an actionable customer remediation.
 */

export type DiagnosticCode =
	| "PORT_MISMATCH"
	| "HOST_VALIDATION_REJECTION"
	| "WRONG_START_COMMAND"
	| "MISSING_BUILD_OUTPUT"
	| "DEPENDENCY_FAILED"
	| "UNSUPPORTED_RUNTIME"
	| "APPLICATION_CRASH"
	| "WRONG_APPLICATION_ROOT"
	| "DNS_MISCONFIGURATION"
	| "TLS_ISSUANCE_FAILED"
	| "WRONG_READINESS_ENDPOINT"
	| "STALE_ROUTER"
	| "CONTAINER_RUNNING_NO_LISTENER"
	| "COMMAND_EXITED_EARLY"
	| "MALFORMED_PACKAGE_JSON"
	| "HOST_VALIDATION_MANUAL_CONFIGURATION"
	| "UNSUPPORTED_NATIVE_ARCHITECTURE"
	| "NATIVE_BINDING_RESOLUTION_FAILED"
	| "INCOMPATIBLE_NATIVE_BINDING_VERSION"
	| "UNKNOWN_BUILD_ERROR";

export type DeploymentState =
	| "configuration_failed"
	| "build_failed"
	| "artifact_failed"
	| "runtime_startup_failed"
	| "waiting_for_service_convergence"
	| "internal_readiness_failed"
	| "routing_verification_failed"
	| "tls_pending"
	| "healthy";

export interface DiagnosticInfo {
	code: DiagnosticCode;
	title: string;
	explanation: string;
	remediation: string;
}

export const DIAGNOSTIC_CATALOG: Record<DiagnosticCode, DiagnosticInfo> = {
	PORT_MISMATCH: {
		code: "PORT_MISMATCH",
		title: "Application Port Mismatch",
		explanation:
			"The application is listening on a different port than the reverse proxy is routing traffic to.",
		remediation:
			"Configure the exact listening port in Application Settings (Target Port) or set the PORT environment variable to match the server.",
	},
	HOST_VALIDATION_REJECTION: {
		code: "HOST_VALIDATION_REJECTION",
		title: "Framework Host Header Validation Rejection",
		explanation:
			"The framework server (such as Vite, Django, or Rails) rejected the assigned HatDot hostname.",
		remediation:
			"Add the hostname to the framework's allowed hosts configuration (preview.allowedHosts in vite.config, ALLOWED_HOSTS in Django settings, or config.hosts in Rails).",
	},
	WRONG_START_COMMAND: {
		code: "WRONG_START_COMMAND",
		title: "Incorrect Application Startup Command",
		explanation:
			"The application startup command exited with an error, could not be found, or attempted to run a development server in production.",
		remediation:
			"Verify scripts in package.json and configure a valid production start command (e.g. 'npm start' or 'npm run preview -- --port 4173 --host 0.0.0.0').",
	},
	MISSING_BUILD_OUTPUT: {
		code: "MISSING_BUILD_OUTPUT",
		title: "Missing Build Output Directory or Artifact",
		explanation:
			"The build succeeded but the expected output directory (e.g. dist, build, .next, out) does not exist.",
		remediation:
			"Ensure your build script creates the configured Publish Directory, or adjust the Publish Directory setting in Application Settings.",
	},
	DEPENDENCY_FAILED: {
		code: "DEPENDENCY_FAILED",
		title: "Dependency Installation Failed",
		explanation:
			"The package manager failed to install dependencies, possibly due to lockfile conflicts or missing native platform bindings.",
		remediation:
			"Verify your lockfile locally with a clean install, or check for missing optional dependencies.",
	},
	UNSUPPORTED_RUNTIME: {
		code: "UNSUPPORTED_RUNTIME",
		title: "Unsupported or End-Of-Life Runtime Version",
		explanation:
			"The specified runtime version is deprecated or unavailable from verified package sources.",
		remediation:
			"Update the runtime version in package.json engines, .nvmrc, or runtime.txt to an active LTS version (e.g. Node 20 or 22).",
	},
	APPLICATION_CRASH: {
		code: "APPLICATION_CRASH",
		title: "Application Crashed at Startup",
		explanation:
			"The container started, but the process terminated with a non-zero exit code during initial execution.",
		remediation:
			"Review the container logs in Deployment Logs to identify runtime exceptions, missing environment variables, or uncaught errors.",
	},
	WRONG_APPLICATION_ROOT: {
		code: "WRONG_APPLICATION_ROOT",
		title: "Incorrect Monorepo Application Root",
		explanation:
			"HatDot could not find the application manifest in the configured root directory.",
		remediation:
			"Set the Build Path in Application Settings to the subdirectory containing your application's package.json or project file.",
	},
	DNS_MISCONFIGURATION: {
		code: "DNS_MISCONFIGURATION",
		title: "DNS Resolution Failed",
		explanation:
			"The assigned domain could not be resolved or resolved to non-public/loopback addresses.",
		remediation:
			"Verify that an A/CNAME record points to your HatDot server IP, or use a platform-provided wildcard subdomain.",
	},
	TLS_ISSUANCE_FAILED: {
		code: "TLS_ISSUANCE_FAILED",
		title: "HTTPS Certificate Issuance Failed",
		explanation:
			"Let's Encrypt could not verify domain ownership or the certificate does not cover the requested hostname.",
		remediation:
			"Check domain DNS propagation and ensure the hostname depth matches your SSL certificate (wildcards do not cover nested subdomains like www.app.hatdot.cloud).",
	},
	WRONG_READINESS_ENDPOINT: {
		code: "WRONG_READINESS_ENDPOINT",
		title: "Readiness Probe Endpoint Failed",
		explanation:
			"The configured health check path returned an unexpected error or timed out.",
		remediation:
			"Ensure your application responds to HTTP requests on the readiness path (default: /), or set HATDOT_HEALTH_PATH in environment variables.",
	},
	STALE_ROUTER: {
		code: "STALE_ROUTER",
		title: "Stale Ingress Router Configuration",
		explanation:
			"Traefik router configuration contains outdated upstream endpoints or competing route rules.",
		remediation:
			"Trigger an application reload or clean stale domains to re-synchronize Traefik routers.",
	},
	CONTAINER_RUNNING_NO_LISTENER: {
		code: "CONTAINER_RUNNING_NO_LISTENER",
		title: "Container Running but No Network Listener",
		explanation:
			"The Docker container is running, but no process is listening on the expected network interface (0.0.0.0).",
		remediation:
			"Ensure your server binds to 0.0.0.0 (all interfaces) rather than 127.0.0.1 (localhost).",
	},
	COMMAND_EXITED_EARLY: {
		code: "COMMAND_EXITED_EARLY",
		title: "Startup Command Exited Immediately",
		explanation:
			"The startup command finished successfully (exit code 0) but did not keep a background daemon or web server running.",
		remediation:
			"Ensure the start command launches a persistent web server process (e.g. 'node server.js' or 'vite preview') instead of a short-lived build or script.",
	},
	MALFORMED_PACKAGE_JSON: {
		code: "MALFORMED_PACKAGE_JSON",
		title: "Malformed package.json",
		explanation: "The repository's package.json contains syntax errors and could not be parsed.",
		remediation: "Validate package.json syntax with a JSON linter.",
	},
	HOST_VALIDATION_MANUAL_CONFIGURATION: {
		code: "HOST_VALIDATION_MANUAL_CONFIGURATION",
		title: "Manual Host Validation Configuration Required",
		explanation: "The application framework requires explicit allowed-host configuration.",
		remediation: "Follow the framework-specific guide to add the domain to trusted hosts.",
	},
	UNSUPPORTED_NATIVE_ARCHITECTURE: {
		code: "UNSUPPORTED_NATIVE_ARCHITECTURE",
		title: "Unsupported CPU Architecture for Native Bindings",
		explanation:
			"The application requires prebuilt native binaries (such as Rolldown) that are not published for this CPU architecture.",
		remediation:
			"Deploy to an x86_64 (amd64) or aarch64 (arm64) Linux server host, or configure a custom Dockerfile.",
	},
	NATIVE_BINDING_RESOLUTION_FAILED: {
		code: "NATIVE_BINDING_RESOLUTION_FAILED",
		title: "Native Binary Resolution Failed",
		explanation:
			"A platform-specific native binary package (e.g. Rolldown) omitted from the lockfile could not be installed.",
		remediation:
			"Ensure your package manager can reach the npm registry, or commit a Linux-compatible lockfile.",
	},
	INCOMPATIBLE_NATIVE_BINDING_VERSION: {
		code: "INCOMPATIBLE_NATIVE_BINDING_VERSION",
		title: "Incompatible Native Binding Version",
		explanation:
			"The installed native binary version does not match the version required by your bundler or framework.",
		remediation:
			"Run npm update or align optional dependency versions in your package manifest.",
	},
	UNKNOWN_BUILD_ERROR: {
		code: "UNKNOWN_BUILD_ERROR",
		title: "Unexpected Build Error",
		explanation:
			"An unexpected error occurred during the build process.",
		remediation:
			"Check your project build configuration or contact HatDot support with your deployment ID.",
	},
};

/**
 * Redacts passwords, bearer tokens, API keys, and sensitive environment variables from logs.
 */
/**
 * Redacts passwords, bearer tokens, API keys, private keys, database credentials,
 * and sensitive environment variables from logs.
 */
export const redactSensitiveInformation = (text: string): string => {
	if (!text) return "";
	return text
		// Redact private keys (RSA, EC, OPENSSH, etc.)
		.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
		// Redact database URIs with passwords: postgres://user:pass@host:5432/db or redis://:pass@host:6379
		.replace(/([a-zA-Z0-9+.-]+:\/\/(?:[^:\s'"]*:)?)([^\s'"]+?)(@[a-zA-Z0-9_.-]+(?::\d+)?(?=[/?#'"\s]|$))/g, "$1••••••••$3")
		// Redact query parameter credentials: ?token=xyz or &password=xyz
		.replace(/([?&](?:password|passwd|secret|token|api[_-]?key|auth)=)[^&\s'"]+/gi, "$1••••••••")
		// Redact Authorization headers and tokens
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ••••••••")
		.replace(/Basic\s+[A-Za-z0-9+/=]+=*/gi, "Basic ••••••••")
		// Redact CLI flags: --password=xyz or --token xyz
		.replace(/--(?:password|passwd|token|secret|api[_-]?key|auth)[\s=]+([^\s"']+)/gi, (match, val) => {
			return match.replace(val, "••••••••");
		})
		// Redact environment variable assignments: SECRET=xyz or API_KEY=xyz
		.replace(/(?:password|passwd|secret|token|api[_-]?key|auth|jwt|private[_-]?key)[\s=:"]+([^\s,;"]+)/gi, (match, val) => {
			if (val.length <= 4) return match.replace(val, "••••");
			return match.replace(val, `${val.slice(0, 2)}••••${val.slice(-2)}`);
		});
};

/**
 * Emits a structured, correlated log line for operational observability.
 */
export const formatCorrelatedLog = (entry: {
	deploymentId?: string;
	applicationId: string;
	appName: string;
	stage: string;
	state: DeploymentState;
	code?: DiagnosticCode;
	message: string;
	details?: Record<string, any>;
}): string => {
	const timestamp = new Date().toISOString();
	const sanitizedDetails = entry.details
		? JSON.stringify(entry.details)
		: "";

	return `[${timestamp}] [App: ${entry.appName}] [Stage: ${entry.stage}] [State: ${entry.state}]${
		entry.code ? ` [Code: ${entry.code}]` : ""
	} ${redactSensitiveInformation(entry.message)} ${sanitizedDetails}`.trim();
};
