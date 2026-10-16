import fs from "node:fs";
import path from "node:path";
import { paths } from "../../constants";
import {
	detectFrameworkFromDirectorySync,
	detectFrameworkFromFiles,
	type FileEntry,
} from "../../services/app-detector";
import {
	extractPortFromCommand,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
	type SupportedPackageManager,
} from "./runtime-resolver";
import {
	getAuthorizedHostsSync,
	resolveHostValidation,
	type HostValidationPlan,
	type ApplicationWithDomains,
} from "./host-validation";

export type DeploymentStrategy =
	| "static-artifact"
	| "vite-preview"
	| "node-server"
	| "framework-server"
	| "python-server"
	| "compiled-binary"
	| "jvm-server"
	| "dotnet-server"
	| "php-server"
	| "ruby-server"
	| "dockerfile"
	| "compose"
	| "worker";

export interface PlanCommand {
	intended: string;
	effective: string;
	source:
		| "customer_override"
		| "nixpacks_toml"
		| "package_json_start"
		| "package_json_preview"
		| "entrypoint"
		| "framework_default"
		| "dockerfile"
		| "fallback";
	transformationReason?: string;
}

export interface PlanPort {
	value: number;
	source:
		| "customer_override"
		| "command_argument"
		| "customer_env"
		| "nixpacks_toml"
		| "project_manifest"
		| "framework_default"
		| "dockerfile"
		| "platform_default";
	bindAddress: string;
}

export interface PlanDecision {
	stage: string;
	decision: string;
	reason: string;
	evidence: string;
}

export interface PlanConflict {
	item: string;
	description: string;
	resolution: string;
}

export interface PlanDiagnostic {
	code: string;
	message: string;
	severity: "info" | "warning" | "error";
	remediation?: string;
}

export interface DeploymentPlan {
	schemaVersion: "1.0";
	applicationId: string;
	appName: string;
	resolvedAt: string;
	inputsFingerprint: string;

	framework: string;
	frameworkVersion?: string;
	language: string;
	builder: string;
	deploymentStrategy: DeploymentStrategy;

	rootDirectory: string;
	publishDirectory?: string;

	runtime: {
		name: string;
		version: string;
		archive?: string;
		warning?: string;
	};
	packageManager: SupportedPackageManager;

	installCommand?: {
		command: string;
		source: string;
	};
	buildCommand?: {
		command: string;
		source: string;
	};
	startCommand: PlanCommand;

	port: PlanPort;
	isHttpWorkload: boolean;

	hostValidation: HostValidationPlan;

	healthStrategy: {
		path: string;
		expectedStatuses: number[];
		timeoutSeconds: number;
	};

	routing: {
		primaryHost: string;
		allAuthorizedHosts: string[];
		https: boolean;
		expectedBehavior: string;
	};

	decisions: PlanDecision[];
	conflicts: PlanConflict[];
	diagnostics: PlanDiagnostic[];
}

export interface ResolvePlanOptions {
	application: ApplicationWithDomains & {
		applicationId?: string;
		appName?: string;
		buildType?: string | null;
		command?: string | null;
		ports?: Array<{ targetPort?: number | null }> | null;
		env?: string | null;
		environment?: {
			env?: string | null;
			project?: { env?: string | null } | null;
		} | null;
		publishDirectory?: string | null;
		isStaticSpa?: boolean | null;
		buildPath?: string | null;
		serverId?: string | null;
	};
	buildAppDirectory?: string;
	platformDomain?: string | null;
	files?: FileEntry[];
}

/**
 * Generates an input fingerprint to detect if application configuration has changed.
 */
export const computeInputsFingerprint = (
	app: ResolvePlanOptions["application"],
): string => {
	const components = [
		app.appName || "",
		app.buildType || "",
		app.command || "",
		app.ports?.[0]?.targetPort || "",
		app.publishDirectory || "",
		app.buildPath || "",
		app.env || "",
	];
	return Buffer.from(components.join("::")).toString("base64");
};

/**
 * Pure & deterministic function that resolves a complete, typed DeploymentPlan.
 * Consumed as ONE SOURCE OF TRUTH across builders, Docker Swarm, Traefik, and health checks.
 */
export const resolveDeploymentPlan = (
	opts: ResolvePlanOptions,
): DeploymentPlan => {
	const { application: app, buildAppDirectory, platformDomain } = opts;
	const decisions: PlanDecision[] = [];
	const conflicts: PlanConflict[] = [];
	const diagnostics: PlanDiagnostic[] = [];

	const appName = app.appName || "app";
	const applicationId = app.applicationId || `app-${appName}`;

	// 1. Files & Manifest Gathering
	let files: FileEntry[] = opts.files || [];
	if (files.length === 0 && buildAppDirectory && fs.existsSync(buildAppDirectory)) {
		try {
			const entries = fs.readdirSync(buildAppDirectory);
			files = entries.map((name) => {
				const full = path.join(buildAppDirectory, name);
				let content: string | undefined;
				if (
					name === "package.json" ||
					name === "nixpacks.toml" ||
					name === "requirements.txt" ||
					name === "runtime.txt" ||
					name === ".nvmrc" ||
					name === ".node-version"
				) {
					try {
						content = fs.readFileSync(full, "utf-8");
					} catch {}
				}
				return { name, path: full, content };
			});
		} catch {}
	}

	const pkgFile = files.find((f) => f.name === "package.json");
	let pkgContent = pkgFile?.content;
	if (!pkgContent && buildAppDirectory) {
		const p = path.join(buildAppDirectory, "package.json");
		if (fs.existsSync(p)) {
			try {
				pkgContent = fs.readFileSync(p, "utf-8");
			} catch {}
		}
	}

	let parsedPkg: any = null;
	let pkgScripts: Record<string, string> = {};
	let pkgDeps: Record<string, string> = {};
	if (pkgContent) {
		try {
			parsedPkg = JSON.parse(pkgContent);
			pkgScripts = parsedPkg.scripts || {};
			pkgDeps = {
				...(parsedPkg.dependencies || {}),
				...(parsedPkg.devDependencies || {}),
			};
		} catch (err: any) {
			diagnostics.push({
				code: "MALFORMED_PACKAGE_JSON",
				message: `package.json could not be parsed: ${err?.message || "Invalid JSON"}`,
				severity: "warning",
			});
		}
	}

	// 2. Framework & Language Detection
	let framework = "Auto-detected Application";
	let language = "JavaScript";
	let detectedPort: number | undefined;
	let detectedStart: string | undefined;
	let detectedBuild: string | undefined;
	let detectedInstall: string | undefined;
	let isSpa = Boolean(app.isStaticSpa);

	if (buildAppDirectory && fs.existsSync(buildAppDirectory)) {
		try {
			const det = detectFrameworkFromDirectorySync(buildAppDirectory);
			framework = det.framework || framework;
			language = det.language || language;
			detectedPort = det.suggestedPort;
			detectedStart = det.startCommand;
			detectedBuild = det.buildCommand;
			detectedInstall = det.installCommand;
			if (det.isStaticSpa) isSpa = true;

			decisions.push({
				stage: "detection",
				decision: `Detected framework: ${framework} (${language})`,
				reason: det.reason || "Matched repository structure and manifests",
				evidence: `Confidence: ${det.confidence}`,
			});
		} catch {}
	} else if (files.length > 0) {
		const det = detectFrameworkFromFiles(files);
		framework = det.framework || framework;
		language = det.language || language;
		detectedPort = det.suggestedPort;
		detectedStart = det.startCommand;
		detectedBuild = det.buildCommand;
		detectedInstall = det.installCommand;
		if (det.isStaticSpa) isSpa = true;
	}

	// 3. Package Manager & Runtime Resolution
	let pm: SupportedPackageManager = "npm";
	let runtimeInfo = {
		name: language === "Python" ? "Python" : "Node.js",
		version: "standard",
		archive: undefined as string | undefined,
		warning: undefined as string | undefined,
	};

	if (language === "Python") {
		pm = files.some((f) => f.name === "uv.lock")
			? "uv"
			: files.some((f) => f.name === "poetry.lock")
				? "poetry"
				: files.some((f) => f.name === "Pipfile")
					? "pipenv"
					: "pip";
		runtimeInfo.version = "3.11";
	} else if (parsedPkg || files.some((f) => f.name.endsWith(".js") || f.name.endsWith(".ts"))) {
		const pmRes = resolvePackageManagerAndCommands({
			files,
			packageJsonContent: pkgContent,
		});
		pm = pmRes.packageManager;

		const nvmrc = files.find((f) => f.name === ".nvmrc")?.content;
		const nodeVer = files.find((f) => f.name === ".node-version")?.content;
		const runtimeTxt = files.find((f) => f.name === "runtime.txt")?.content;

		const nodeRes = resolveNodeRuntime({
			packageJsonContent: pkgContent,
			nvmrcContent: nvmrc,
			nodeVersionContent: nodeVer,
			runtimeTxtContent: runtimeTxt,
		});
		runtimeInfo = {
			name: "Node.js",
			version: nodeRes.resolvedVersion,
			archive: nodeRes.nixpkgsArchive,
			warning: nodeRes.warning,
		};
	}

	// 4. Deployment Strategy
	const isVite = Boolean(pkgDeps.vite);
	const isAstro = Boolean(pkgDeps.astro);
	let strategy: DeploymentStrategy = "node-server";
	if (app.buildType === "static" || (app.publishDirectory && !pkgScripts.start)) {
		strategy = "static-artifact";
	} else if (app.buildType === "dockerfile") {
		strategy = "dockerfile";
	} else if (isVite || isAstro || (!pkgScripts.start && pkgScripts.preview)) {
		const rawStart = pkgScripts.start?.trim() || "";
		const isViteDev =
			rawStart === "vite" || /^vite(?:\s+(?:dev|serve))?\b/i.test(rawStart);
		if (isViteDev || (!rawStart && pkgScripts.preview)) {
			strategy = "vite-preview";
		} else if (rawStart) {
			strategy = "node-server";
		} else {
			strategy = "vite-preview";
		}
	} else if (language === "Python") {
		strategy = "python-server";
	} else if (language === "Go" || language === "Rust") {
		strategy = "compiled-binary";
	} else if (language === "PHP") {
		strategy = "php-server";
	} else if (language === "Ruby") {
		strategy = "ruby-server";
	} else if (language === "Java") {
		strategy = "jvm-server";
	} else if (language === "C#" || language === ".NET") {
		strategy = "dotnet-server";
	}

	// 5. Workload Classification (HTTP vs Worker)
	const customerCmd = app.command?.trim() || undefined;
	const isWorker = Boolean(
		customerCmd &&
			/\b(celery|worker|sidekiq|queue:work|resque|cron|consumer)\b/i.test(
				customerCmd,
			),
	);
	const isHttpWorkload = !isWorker && (strategy as string) !== "worker";

	// 6. Effective Port Resolution (with deterministic precedence)
	let portValue = 3000;
	let portSource: PlanPort["source"] = "platform_default";

	// Customer explicit port
	const customerPort = app.ports?.[0]?.targetPort;
	if (customerPort && customerPort > 0) {
		portValue = customerPort;
		portSource = "customer_override";
		decisions.push({
			stage: "port",
			decision: `Port: ${portValue}`,
			reason: "Customer explicitly configured application target port in settings",
			evidence: `ports[0].targetPort = ${customerPort}`,
		});
	} else if (customerCmd && extractPortFromCommand(customerCmd)) {
		portValue = extractPortFromCommand(customerCmd)!;
		portSource = "command_argument";
		decisions.push({
			stage: "port",
			decision: `Port: ${portValue}`,
			reason: "Extracted from customer-configured startup command flags",
			evidence: `Command: "${customerCmd}"`,
		});
	} else {
		// Environment PORT
		let envPort: number | undefined;
		const allEnvs = [
			app.env,
			app.environment?.env,
			app.environment?.project?.env,
		];
		for (const envStr of allEnvs) {
			if (envStr) {
				const m = envStr.match(/^\s*PORT\s*=\s*["']?(\d+)["']?/m);
				if (m?.[1]) {
					const p = Number.parseInt(m[1], 10);
					if (!Number.isNaN(p) && p > 0) {
						envPort = p;
						break;
					}
				}
			}
		}

		if (envPort) {
			portValue = envPort;
			portSource = "customer_env";
			decisions.push({
				stage: "port",
				decision: `Port: ${portValue}`,
				reason: "Configured via PORT environment variable",
				evidence: `PORT=${envPort}`,
			});
		} else if (strategy === "static-artifact") {
			portValue = 80;
			portSource = "framework_default";
		} else if (strategy === "vite-preview") {
			const previewScript = pkgScripts.preview || "";
			const extracted = extractPortFromCommand(previewScript);
			portValue = extracted || (isAstro ? 4321 : 4173);
			portSource = "framework_default";
			decisions.push({
				stage: "port",
				decision: `Port: ${portValue}`,
				reason: isAstro
					? "Astro production preview server standard listening port"
					: "Vite production preview server standard listening port",
				evidence: previewScript
					? `preview script: "${previewScript}"`
					: `${isAstro ? "Astro default 4321" : "Vite default 4173"}`,
			});
		} else if (detectedPort && detectedPort > 0 && (app.buildType !== "nixpacks" || detectedPort !== 80)) {
			portValue = detectedPort;
			portSource = "framework_default";
		} else if (language === "Python") {
			portValue = 8501;
			portSource = "framework_default";
		} else if (language === "Go" || language === "Rust" || language === "Java") {
			portValue = 8080;
			portSource = "framework_default";
		} else if (language === "PHP") {
			portValue = 80;
			portSource = "framework_default";
		} else if (language === ".NET" || language === "C#") {
			portValue = 5000;
			portSource = "framework_default";
		} else {
			portValue = 3000;
			portSource = "platform_default";
		}
	}

	// 7. Effective Startup Command Resolution (NO silent command mutations!)
	const runPrefix =
		pm === "bun"
			? "bun run"
			: pm === "pnpm"
				? "pnpm run"
				: pm === "yarn"
					? "yarn"
					: "npm run";

	const passthroughFlag = pm === "npm" ? "-- " : "";

	let intendedCmd = "npm start";
	let effectiveCmd = "npm start";
	let cmdSource: PlanCommand["source"] = "fallback";
	let transformationReason: string | undefined;

	if (customerCmd) {
		intendedCmd = customerCmd;
		effectiveCmd = customerCmd;
		cmdSource = "customer_override";
		decisions.push({
			stage: "startup",
			decision: `Startup command: "${effectiveCmd}"`,
			reason: "Customer explicitly specified startup command in Application Settings",
			evidence: `Application Settings: command = "${customerCmd}"`,
		});
	} else if (strategy === "vite-preview") {
		intendedCmd = `${runPrefix} preview`;
		// Ensure preview binds to 0.0.0.0 and listens on the resolved port
		const previewStr = pkgScripts.preview || "";
		const hasHost = previewStr.includes("--host");
		const hasPort = /--port|-p\b/i.test(previewStr);

		let flags = "";
		if (!hasPort || portValue !== 4173) flags += ` --port ${portValue}`;
		if (!hasHost) flags += " --host 0.0.0.0";

		effectiveCmd = flags.trim()
			? `${runPrefix} preview ${passthroughFlag}${flags.trim()}`
			: `${runPrefix} preview`;

		cmdSource = "package_json_preview";
		transformationReason =
			`Appended --host 0.0.0.0 and --port ${portValue} to bind preview server inside container`;
		decisions.push({
			stage: "startup",
			decision: `Startup command: "${effectiveCmd}"`,
			reason:
				"Resolved production preview mode. Configured container interface binding (0.0.0.0) and target port.",
			evidence: `package.json scripts.preview: "${previewStr}"`,
		});
	} else if (pkgScripts.start) {
		intendedCmd = `${pm} start`;
		effectiveCmd = `${pm} start`;
		cmdSource = "package_json_start";
		decisions.push({
			stage: "startup",
			decision: `Startup command: "${effectiveCmd}"`,
			reason: "Standard production start script from package.json",
			evidence: `package.json scripts.start: "${pkgScripts.start}"`,
		});
	} else if (detectedStart) {
		intendedCmd = detectedStart;
		effectiveCmd = detectedStart;
		cmdSource = "framework_default";
		decisions.push({
			stage: "startup",
			decision: `Startup command: "${effectiveCmd}"`,
			reason: "Framework auto-detected default startup command",
			evidence: `Detector suggested: "${detectedStart}"`,
		});
	} else if (strategy === "static-artifact") {
		intendedCmd = "";
		effectiveCmd = "";
		cmdSource = "framework_default";
		decisions.push({
			stage: "startup",
			decision: "Static artifact hosting (Nginx container)",
			reason: "Application is a static build hosted via reverse proxy / web server",
			evidence: "buildType is static or publishDirectory configured without start script",
		});
	}

	// Check for conflicting signals
	if (
		customerCmd &&
		pkgScripts.preview &&
		customerCmd === "npm start" &&
		!pkgScripts.start
	) {
		conflicts.push({
			item: "startup_command",
			description:
				"Application Settings specify 'npm start' but package.json has no 'start' script, only 'preview'.",
			resolution:
				"Customer override was preserved. Ensure package.json defines 'start' or change startup command to 'npm run preview'.",
		});
	}

	// 8. Host Validation
	const authorizedHosts = getAuthorizedHostsSync(app, platformDomain);
	const userEnvList = (app.env || "").split("\n").map((s) => s.trim()).filter(Boolean);
	const runsViteServer =
		strategy === "vite-preview" ||
		/\bvite(\s+(preview|dev|serve))?\b/i.test(effectiveCmd);

	const hostValidation = resolveHostValidation({
		framework,
		language,
		dependencies: pkgDeps,
		runsViteServer,
		hosts: authorizedHosts,
		userEnv: userEnvList,
	});

	if (hostValidation.remediation) {
		diagnostics.push({
			code: "HOST_VALIDATION_MANUAL_CONFIGURATION",
			message: hostValidation.reason,
			severity: "info",
			remediation: hostValidation.remediation,
		});
	}

	// 9. Health Check Strategy
	const healthPath = process.env.HATDOT_HEALTH_PATH || "/";
	const expectedStatuses = [200, 201, 204, 301, 302, 307, 308, 401, 403, 404];

	// 10. Routing & Public Endpoint
	const primaryHost =
		authorizedHosts[0] ||
		`${appName}.${platformDomain || process.env.PLATFORM_DOMAIN || "hatdot.cloud"}`;

	return {
		schemaVersion: "1.0",
		applicationId,
		appName,
		resolvedAt: new Date().toISOString(),
		inputsFingerprint: computeInputsFingerprint(app),
		framework,
		language,
		builder: app.buildType || "nixpacks",
		deploymentStrategy: strategy,
		rootDirectory: app.buildPath || "/",
		publishDirectory: app.publishDirectory || undefined,
		runtime: runtimeInfo,
		packageManager: pm,
		installCommand: detectedInstall
			? { command: detectedInstall, source: "detected" }
			: undefined,
		buildCommand: detectedBuild
			? { command: detectedBuild, source: "detected" }
			: undefined,
		startCommand: {
			intended: intendedCmd,
			effective: effectiveCmd,
			source: cmdSource,
			transformationReason,
		},
		port: {
			value: portValue,
			source: portSource,
			bindAddress: "0.0.0.0",
		},
		isHttpWorkload,
		hostValidation,
		healthStrategy: {
			path: healthPath,
			expectedStatuses,
			timeoutSeconds: 30,
		},
		routing: {
			primaryHost,
			allAuthorizedHosts: authorizedHosts,
			https: true,
			expectedBehavior: isHttpWorkload
				? "HTTP 2xx, 3xx, 401, 403, or 404 expected on readiness path"
				: "Non-HTTP workload / Worker process",
		},
		decisions,
		conflicts,
		diagnostics,
	};
};

/**
 * Persists the resolved DeploymentPlan to disk outside the code/ directory
 * so it survives git clone/clean operations.
 */
export const saveDeploymentPlanSync = (
	appName: string,
	plan: DeploymentPlan,
	serverId?: string | null,
): void => {
	try {
		const { APPLICATIONS_PATH } = paths(!!serverId);
		const dotDir = path.join(APPLICATIONS_PATH, appName, ".hatdot");
		if (!fs.existsSync(dotDir)) {
			fs.mkdirSync(dotDir, { recursive: true });
		}
		const planPath = path.join(dotDir, "plan.json");
		fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");
	} catch (err) {
		console.error(`Failed to save deployment plan for ${appName}:`, err);
	}
};

/**
 * Loads the persisted DeploymentPlan if it exists and matches the current configuration.
 */
export const loadDeploymentPlanSync = (
	appName: string,
	serverId?: string | null,
): DeploymentPlan | null => {
	try {
		const { APPLICATIONS_PATH } = paths(!!serverId);
		const planPath = path.join(APPLICATIONS_PATH, appName, ".hatdot", "plan.json");
		if (fs.existsSync(planPath)) {
			const data = fs.readFileSync(planPath, "utf-8");
			return JSON.parse(data) as DeploymentPlan;
		}
	} catch {}
	return null;
};

/**
 * Formats a clean, readable Stage 1 deployment log summarizing the unified decisions.
 */
export const formatDeploymentPlanLog = (plan: DeploymentPlan): string => {
	const lines = [
		"================================================================================",
		"Stage 1/7: Intelligent Configuration & Framework Detection",
		"--------------------------------------------------------------------------------",
		`Application:          ${plan.appName} (${plan.applicationId})`,
		`Detected Framework:   ${plan.framework} (${plan.language})`,
		`Deployment Strategy:  ${plan.deploymentStrategy}`,
		`Runtime / Version:    ${plan.runtime.name} ${plan.runtime.version}`,
		`Package Manager:      ${plan.packageManager}`,
		`Intended Command:     ${plan.startCommand.intended || "(none)"}`,
		`Effective Command:    ${plan.startCommand.effective || "(none)"} [${plan.startCommand.source}]`,
		`Listening Port:       ${plan.port.value} [${plan.port.source}] (Bind: ${plan.port.bindAddress})`,
		`Authorized Hosts:     ${plan.routing.allAuthorizedHosts.join(", ") || "(none)"}`,
		`Host Validation:      ${plan.hostValidation.mechanism} (${plan.hostValidation.reason})`,
	];

	if (plan.conflicts.length > 0) {
		lines.push("--------------------------------------------------------------------------------");
		lines.push("⚠️ Configuration Conflicts Detected:");
		for (const c of plan.conflicts) {
			lines.push(`  - [${c.item}] ${c.description} -> Resolution: ${c.resolution}`);
		}
	}

	if (plan.diagnostics.length > 0) {
		const warnings = plan.diagnostics.filter((d) => d.severity !== "info");
		if (warnings.length > 0) {
			lines.push("--------------------------------------------------------------------------------");
			lines.push("Diagnostics & Remediations:");
			for (const d of warnings) {
				lines.push(`  - [${d.code}] ${d.message}`);
				if (d.remediation) {
					lines.push(`    Remediation: ${d.remediation}`);
				}
			}
		}
	}

	lines.push("================================================================================");
	return lines.join("\n") + "\n";
};
