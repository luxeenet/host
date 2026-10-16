import fs from "node:fs";
import path from "node:path";
import {
	extractPortFromCommand,
	resolveDotnetRuntime,
	resolveGoRuntime,
	resolveJavaRuntime,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
	resolvePhpRuntime,
	resolvePythonRuntime,
	resolveRubyRuntime,
	resolveRustRuntime,
} from "../utils/builders/runtime-resolver";
import { findApplicationById } from "./application";

export interface FileEntry {
	name: string;
	path: string;
	content?: string;
}

export type BuildTypeRecommendation =
	| "nixpacks"
	| "dockerfile"
	| "railpack"
	| "static"
	| "compose"
	| "paketo_buildpacks"
	| "heroku_buildpacks";

export interface DetectionResult {
	framework: string;
	language: string;
	buildType: BuildTypeRecommendation;
	suggestedPort: number;
	buildCommand?: string;
	startCommand?: string;
	publishDirectory?: string;
	dockerfilePath?: string;
	packageManager?:
		| "npm"
		| "pnpm"
		| "yarn"
		| "bun"
		| "pip"
		| "poetry"
		| "pipenv"
		| "uv"
		| "composer"
		| "bundler"
		| "maven"
		| "gradle"
		| "cargo"
		| "go"
		| "dotnet";
	runtimeVersion?: string;
	isStaticSpa?: boolean;
	confidence: "high" | "medium" | "low";
	reason: string;
	suggestedEnv?: Array<{ key: string; description: string; required: boolean }>;
	projectRoot?: string;
	installCommand?: string;
	bindHost?: string;
	conflicts?: string[];
	runtimeEvidence?: string;
	packageManagerEvidence?: string;
}

export interface ApplicationInspection {
	applicationId?: string;
	appName?: string;
	detected: DetectionResult;
	isLiveReady: boolean;
	sourceType: string;
	healthRecommendation: {
		checkPath: string;
		expectedPort: number;
	};
}

const IGNORED_SCAN_DIRS = new Set([
	".git",
	"node_modules",
	".venv",
	"venv",
	"env",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	"dist",
	"build",
	"out",
	"target",
	".next",
	".nuxt",
	".output",
	".turbo",
	".cache",
	".idea",
	".vscode",
	"vendor",
	"storage",
	"logs",
	"coverage",
]);

export const isRecognizedProjectManifest = (fileName: string): boolean => {
	const lower = fileName.toLowerCase();
	return (
		[
			"package.json",
			"requirements.txt",
			"pyproject.toml",
			"pipfile",
			"pipfile.lock",
			"poetry.lock",
			"uv.lock",
			"setup.py",
			"setup.cfg",
			"app.py",
			"main.py",
			"streamlit_app.py",
			"manage.py",
			"dockerfile",
			"dockerfile.production",
			"docker-compose.yml",
			"docker-compose.yaml",
			"compose.yml",
			"compose.yaml",
			"nixpacks.toml",
			"go.mod",
			"cargo.toml",
			"pom.xml",
			"build.gradle",
			"build.gradle.kts",
			"composer.json",
			"gemfile",
			"index.html",
			"index.php",
		].includes(lower) ||
		lower.endsWith(".csproj") ||
		lower.endsWith(".sln")
	);
};

export { extractPortFromCommand };

export const resolveProjectRoot = (
	baseDir: string,
	explicitSubPath?: string,
): {
	resolvedRoot: string;
	isAmbiguous: boolean;
	candidates: string[];
	ambiguityWarning?: string;
} => {
	if (explicitSubPath && explicitSubPath.trim() && explicitSubPath.trim() !== "/") {
		const clean = explicitSubPath.trim().replace(/^[/\\]+/, "").replace(/\\/g, "/");
		const full = path.join(baseDir, clean);
		if (fs.existsSync(full)) {
			return { resolvedRoot: clean, isAmbiguous: false, candidates: [clean] };
		}
	}

	if (!fs.existsSync(baseDir)) {
		return { resolvedRoot: "", isAmbiguous: false, candidates: [] };
	}

	try {
		const rootEntries = fs.readdirSync(baseDir, { withFileTypes: true });
		const hasRootManifest = rootEntries.some(
			(e) => e.isFile() && isRecognizedProjectManifest(e.name),
		);

		if (hasRootManifest) {
			return { resolvedRoot: "", isAmbiguous: false, candidates: [""] };
		}

		const candidates: string[] = [];
		for (const entry of rootEntries) {
			if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
				const subDir = path.join(baseDir, entry.name);
				try {
					const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
					const hasSubManifest = subEntries.some(
						(se) => se.isFile() && isRecognizedProjectManifest(se.name),
					);
					if (hasSubManifest) {
						candidates.push(entry.name);
					}
				} catch {}
			}
		}

		if (candidates.length === 1 && candidates[0]) {
			return { resolvedRoot: candidates[0], isAmbiguous: false, candidates };
		}

		if (candidates.length > 1) {
			return {
				resolvedRoot: "",
				isAmbiguous: true,
				candidates,
				ambiguityWarning: `Multiple application projects detected: [${candidates.join(", ")}]. Please specify a project root in Application Settings to select a specific subproject.`,
			};
		}
	} catch {}

	return { resolvedRoot: "", isAmbiguous: false, candidates: [] };
};

/**
 * Deterministically inspect a virtual or physical list of files to detect framework,
 * builder, start/build commands, runtime versions, and default container ports.
 */
export const detectFrameworkFromFiles = (
	files: FileEntry[],
): DetectionResult => {
	const rootFileMap = new Map<string, FileEntry>();
	const allFileMap = new Map<string, FileEntry>();

	for (const file of files) {
		const normPath = file.path.replace(/^[/\\]+/, "").toLowerCase().replace(/\\/g, "/");
		const baseName = (file.name || path.basename(file.path)).toLowerCase();
		allFileMap.set(normPath, file);
		if (!allFileMap.has(baseName)) {
			allFileMap.set(baseName, file);
		}

		// A file is considered root if it has no directory separators or is directly at './'
		const isRoot = !normPath.includes("/") || (normPath.startsWith("./") && !normPath.slice(2).includes("/"));
		if (isRoot) {
			const cleanRootName = normPath.replace(/^\.\//, "");
			rootFileMap.set(cleanRootName, file);
			rootFileMap.set(baseName, file);
		}
	}

	const getRootFile = (name: string): FileEntry | undefined => {
		const lower = name.toLowerCase();
		return rootFileMap.get(lower);
	};

	const getFile = (name: string): FileEntry | undefined => {
		const lower = name.toLowerCase();
		return rootFileMap.get(lower) || allFileMap.get(lower);
	};

	// 1. Check for Docker Compose
	const composeFile =
		getRootFile("docker-compose.yml") ||
		getRootFile("docker-compose.yaml") ||
		getRootFile("compose.yml") ||
		getRootFile("compose.yaml") ||
		getFile("docker-compose.yml") ||
		getFile("docker-compose.yaml") ||
		getFile("compose.yml") ||
		getFile("compose.yaml");
	if (composeFile) {
		let port = 80;
		if (composeFile.content) {
			const portMatch = composeFile.content.match(/["']?(\d+):(\d+)["']?/);
			if (portMatch?.[2]) {
				port = Number.parseInt(portMatch[2], 10);
			}
		}
		return {
			framework: "Docker Compose",
			language: "Docker",
			buildType: "compose",
			suggestedPort: port,
			confidence: "high",
			reason: `Detected Compose file (${composeFile.name || "docker-compose.yml"})`,
		};
	}

	// 2. Check for explicit Dockerfile
	const dockerfile =
		getRootFile("dockerfile") ||
		getRootFile("dockerfile.production") ||
		getFile("dockerfile") ||
		getFile("dockerfile.production");
	if (dockerfile) {
		let port = 3000;
		let foundExpose = false;
		if (dockerfile.content) {
			const exposeMatches = [
				...dockerfile.content.matchAll(/EXPOSE\s+(\d+)/gi),
			];
			if (exposeMatches.length > 0) {
				const lastMatch = exposeMatches[exposeMatches.length - 1];
				if (lastMatch?.[1]) {
					port = Number.parseInt(lastMatch[1], 10);
					foundExpose = true;
				}
			}
		}
		return {
			framework: "Dockerfile",
			language: "Docker",
			buildType: "dockerfile",
			suggestedPort: port,
			dockerfilePath: dockerfile.name || "Dockerfile",
			confidence: "high",
			reason: foundExpose
				? `Detected Dockerfile with EXPOSE ${port}`
				: "Detected Dockerfile at project root",
		};
	}

	// 3. Inspect nixpacks.toml configuration if present
	const nixpacksConfig = getRootFile("nixpacks.toml") || getFile("nixpacks.toml");
	let nixpacksStartCmd: string | undefined;
	let nixpacksPort: number | undefined;
	let nixpacksProviders: string[] = [];

	if (nixpacksConfig?.content) {
		const toml = nixpacksConfig.content;
		const phaseStartMatch = toml.match(
			/\[phases\.start\][\s\S]*?cmd\s*=\s*["']([^"']+)["']/,
		);
		const startMatch = toml.match(/\[start\][\s\S]*?cmd\s*=\s*["']([^"']+)["']/);
		const cmdMatch =
			phaseStartMatch ||
			startMatch ||
			toml.match(/^\s*cmd\s*=\s*["']([^"']+)["']/m);
		if (cmdMatch?.[1]) {
			nixpacksStartCmd = cmdMatch[1].trim();
			const p = extractPortFromCommand(nixpacksStartCmd);
			if (p) nixpacksPort = p;
		}

		const portMatch = toml.match(/^\s*PORT\s*=\s*["']?(\d+)["']?/m);
		if (portMatch?.[1]) {
			const p = Number.parseInt(portMatch[1], 10);
			if (!Number.isNaN(p) && p > 0) nixpacksPort = p;
		}

		const provMatch = toml.match(/providers\s*=\s*\[([^\]]+)\]/);
		if (provMatch?.[1]) {
			nixpacksProviders = provMatch[1]
				.split(",")
				.map((s) => s.replace(/["'\s]/g, ""))
				.filter(Boolean);
		}
	}

	// 4. Check for Cloud Native Buildpacks project.toml
	const projectToml = getRootFile("project.toml") || getFile("project.toml");
	if (projectToml) {
		return {
			framework: "Cloud Native Buildpack",
			language: "Buildpack",
			buildType: "paketo_buildpacks",
			suggestedPort: 8080,
			confidence: "high",
			reason: "Detected Cloud Native Buildpacks configuration (project.toml)",
		};
	}

	// Python manifests inspection
	const rootReqs = getRootFile("requirements.txt");
	const rootPyproject = getRootFile("pyproject.toml");
	const rootPipfile = getRootFile("pipfile");
	const rootPipfileLock = getRootFile("pipfile.lock");
	const rootPoetryLock = getRootFile("poetry.lock");
	const rootUvLock = getRootFile("uv.lock");
	const rootSetupPy = getRootFile("setup.py");
	const rootSetupCfg = getRootFile("setup.cfg");
	const rootPythonVer = getRootFile(".python-version");
	const rootAppPy = getRootFile("app.py");
	const rootMainPy = getRootFile("main.py");
	const rootStreamlitAppPy = getRootFile("streamlit_app.py");
	const rootManagePy = getRootFile("manage.py");
	const rootRuntimeTxt = getRootFile("runtime.txt");

	const hasRootPythonManifest = Boolean(
		rootReqs ||
		rootPyproject ||
		rootPipfile ||
		rootPipfileLock ||
		rootPoetryLock ||
		rootUvLock ||
		rootSetupPy ||
		rootSetupCfg ||
		rootPythonVer ||
		rootAppPy ||
		rootMainPy ||
		rootStreamlitAppPy ||
		rootManagePy ||
		(rootRuntimeTxt?.content && /python/i.test(rootRuntimeTxt.content)),
	);

	// Root package.json check (nested frontend/package.json must not hijack root Python)
	const rootPkgFile = getRootFile("package.json");
	const allPkgFile = getFile("package.json");
	const effectivePkgFile = rootPkgFile || (!hasRootPythonManifest ? allPkgFile : undefined);

	// File items for JS package manager resolution
	const fileItems = Array.from(rootFileMap.size > 0 ? rootFileMap.values() : allFileMap.values()).map((f) => ({
		name: f.name || path.basename(f.path),
		path: f.path,
		content: f.content,
	}));

	const pkgFile = effectivePkgFile;
	const nvmrcFile = getRootFile(".nvmrc") || getFile(".nvmrc");
	const nodeVersionFile = getRootFile(".node-version") || getFile(".node-version");
	const runtimeTxtFile = getRootFile("runtime.txt") || getFile("runtime.txt");

	const pmRes = resolvePackageManagerAndCommands({
		files: fileItems,
		packageJsonContent: pkgFile?.content,
	});
	const packageManager = pmRes.packageManager;

	const nodeRuntime = resolveNodeRuntime({
		packageJsonContent: pkgFile?.content,
		nvmrcContent: nvmrcFile?.content,
		nodeVersionContent: nodeVersionFile?.content,
		runtimeTxtContent: runtimeTxtFile?.content,
	});

	const runPrefix =
		packageManager === "pnpm"
			? "pnpm"
			: packageManager === "yarn"
				? "yarn"
				: packageManager === "bun"
					? "bun run"
					: "npm run";

	// 5. Node.js / JavaScript / TypeScript projects (package.json)
	if (pkgFile?.content && (!hasRootPythonManifest || rootPkgFile)) {
		try {
			const pkg = JSON.parse(pkgFile.content);
			const allDeps = {
				...(pkg.dependencies || {}),
				...(pkg.devDependencies || {}),
			};
			const scripts = pkg.scripts || {};

			// Check for static export config in Next.js
			const nextConfigFile =
				getFile("next.config.js") ||
				getFile("next.config.mjs") ||
				getFile("next.config.ts");
			const isNextStaticExport =
				Boolean(
					nextConfigFile?.content &&
						/output\s*:\s*["']export["']/.test(nextConfigFile.content),
				) || Boolean(scripts.build?.includes("next export"));

			// Next.js
			if (allDeps.next) {
				if (isNextStaticExport) {
					return {
						framework: "Next.js (Static Export)",
						language: allDeps.typescript ? "TypeScript" : "JavaScript",
						buildType: "static",
						suggestedPort: 80,
						publishDirectory: "out",
						isStaticSpa: false,
						runtimeVersion: nodeRuntime.resolvedVersion,
						packageManager,
						confidence: "high",
						reason:
							"Detected Next.js with static HTML export (output: 'export')",
					};
				}

				return {
					framework: "Next.js",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start
						? packageManager === "bun"
							? "bun start"
							: `${packageManager} start`
						: undefined,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected Next.js in package.json dependencies",
					suggestedEnv: [
						{
							key: "NODE_ENV",
							description: "Application environment mode",
							required: false,
						},
						{
							key: "PORT",
							description: "Application listening port (default: 3000)",
							required: false,
						},
					],
				};
			}

			// Nuxt
			if (allDeps.nuxt || allDeps.nuxt3) {
				return {
					framework: "Nuxt",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: "node .output/server/index.mjs",
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected Nuxt in package.json dependencies",
				};
			}

			// Remix
			if (allDeps["@remix-run/react"] || allDeps["@remix-run/node"]) {
				return {
					framework: "Remix",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start ? `${runPrefix} start` : undefined,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected Remix in package.json dependencies",
				};
			}

			// Astro
			if (allDeps.astro) {
				return {
					framework: "Astro",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 4321,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start ? `${runPrefix} start` : undefined,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected Astro in package.json dependencies",
				};
			}

			// SvelteKit
			if (allDeps["@sveltejs/kit"]) {
				return {
					framework: "SvelteKit",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: "node build",
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected SvelteKit in package.json dependencies",
				};
			}

			// NestJS
			if (allDeps["@nestjs/core"]) {
				return {
					framework: "NestJS",
					language: "TypeScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts["start:prod"]
						? `${runPrefix} start:prod`
						: scripts.start
							? `${runPrefix} start`
							: undefined,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: "Detected NestJS in package.json dependencies",
				};
			}

			// Vite (React / Vue / Svelte SPA)
			if (allDeps.vite) {
				const spaType = allDeps.react
					? "React"
					: allDeps.vue
						? "Vue"
						: allDeps.svelte
							? "Svelte"
							: "Web";
				const rawStartScript = scripts.start ? String(scripts.start).trim() : "";
				const isDevServerStart =
					rawStartScript === "vite" ||
					/^vite(?:\s+(?:dev|serve))?\b/i.test(rawStartScript);
				const isPreviewStart = /\bpreview\b/i.test(rawStartScript);
				const hasPreviewScript = Boolean(scripts.preview);

				let buildType: "nixpacks" | "static" = "static";
				let suggestedPort = 80;
				let startCommand: string | undefined;
				let isStaticSpa = false;

				if (isPreviewStart) {
					// "start" script runs Vite preview server
					buildType = "nixpacks";
					const extracted = extractPortFromCommand(rawStartScript);
					suggestedPort = nixpacksPort || extracted || 4173;
					startCommand = nixpacksStartCmd || (rawStartScript.includes("--host")
						? `${runPrefix} start`
						: `${runPrefix} start -- --port ${suggestedPort} --host 0.0.0.0`);
				} else if (rawStartScript && !isDevServerStart) {
					// Production custom server script (e.g. node server.js, serve dist, etc.)
					buildType = "nixpacks";
					const extracted = extractPortFromCommand(rawStartScript);
					suggestedPort = nixpacksPort || extracted || 3000;
					startCommand = nixpacksStartCmd || `${runPrefix} start`;
				} else if (hasPreviewScript) {
					// Vite preview server available in scripts.preview
					buildType = "nixpacks";
					const previewStr = String(scripts.preview);
					const extracted = extractPortFromCommand(previewStr);
					suggestedPort = nixpacksPort || extracted || 4173;
					const hasHost = previewStr.includes("--host");
					startCommand = nixpacksStartCmd || (hasHost
						? `${runPrefix} preview`
						: `${runPrefix} preview -- --port ${suggestedPort} --host 0.0.0.0`);
				} else {
					// Static Vite SPA -> serve dist directory
					buildType = "static";
					suggestedPort = 80;
					startCommand = nixpacksStartCmd || undefined;
					isStaticSpa = !nixpacksStartCmd;
					if (nixpacksStartCmd) {
						buildType = "nixpacks";
						suggestedPort = nixpacksPort || 3000;
					}
				}

				return {
					framework: `Vite (${spaType})`,
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType,
					suggestedPort,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand,
					publishDirectory: "dist",
					isStaticSpa,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: `Detected Vite (${spaType}) frontend in package.json`,
				};
			}

			// Backend Node.js: Express / Fastify / Koa / Hono
			if (allDeps.express || allDeps.fastify || allDeps.koa || allDeps.hono) {
				const fwName = allDeps.express
					? "Express"
					: allDeps.fastify
						? "Fastify"
						: allDeps.koa
							? "Koa"
							: "Hono";
				const extractedPort = extractPortFromCommand(scripts.start);
				return {
					framework: `Node.js (${fwName})`,
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: extractedPort || 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start
						? packageManager === "bun"
							? "bun start"
							: `${packageManager} start`
						: pkg.main
							? `node ${pkg.main}`
							: "node index.js",
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "high",
					reason: `Detected ${fwName} backend in package.json`,
					suggestedEnv: [
						{
							key: "PORT",
							description: "Server listening port (default: 3000)",
							required: false,
						},
					],
				};
			}

			// Node.js Application with detected start command or entry point
			if (pmRes.startCommand) {
				return {
					framework: "Node.js Application",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: pmRes.startCommand,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "medium",
					reason: `Detected Node.js application (${pmRes.startCommandSource || "start script"})`,
				};
			}

			// Frontend SPA with build script but no backend start script
			if (pmRes.isStaticSpa) {
				return {
					framework: "Frontend SPA",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "static",
					suggestedPort: 80,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					publishDirectory: pmRes.suggestedPublishDirectory || "dist",
					isStaticSpa: true,
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "medium",
					reason:
						"Detected frontend SPA with build script and static asset output (no backend server)",
				};
			}

			// Node.js project without start script - do NOT fall through to Python
			return {
				framework: "Node.js Application",
				language: allDeps.typescript ? "TypeScript" : "JavaScript",
				buildType: "nixpacks",
				suggestedPort: 3000,
				buildCommand: scripts.build ? `${runPrefix} build` : undefined,
				runtimeVersion: nodeRuntime.resolvedVersion,
				packageManager,
				confidence: "low",
				reason:
					pmRes.missingStartCommandDiagnostic?.reason ||
					"Detected Node.js package.json, but no production start script was found",
				suggestedEnv: [
					{
						key: "PORT",
						description: "Server listening port (default: 3000)",
						required: false,
					},
					{
						key: "HOST",
						description: "Server bind host (default: 0.0.0.0)",
						required: false,
					},
				],
			};
		} catch {}
	}

	// 6. Python Projects
	const reqs =
		rootReqs ||
		rootPyproject ||
		rootPipfile ||
		rootPoetryLock ||
		rootUvLock ||
		rootSetupPy ||
		getFile("requirements.txt") ||
		getFile("pyproject.toml") ||
		getFile("pipfile") ||
		getFile("pipfile.lock") ||
		getFile("poetry.lock") ||
		getFile("uv.lock") ||
		getFile("pdm.lock") ||
		getFile("setup.py") ||
		getFile("setup.cfg");

	const isPython = Boolean(
		hasRootPythonManifest ||
		reqs ||
		getFile("app.py") ||
		getFile("main.py") ||
		getFile("streamlit_app.py") ||
		getFile("manage.py") ||
		getFile(".python-version") ||
		(runtimeTxtFile?.content && /python/i.test(runtimeTxtFile.content)),
	);

	if (isPython) {
		let pyPm: "pip" | "poetry" | "uv" | "pipenv" = "pip";
		let pyInstall = "pip install -r requirements.txt";
		if (getRootFile("uv.lock") || getFile("uv.lock")) {
			pyPm = "uv";
			pyInstall = "uv sync";
		} else if (
			getRootFile("poetry.lock") ||
			getFile("poetry.lock") ||
			((rootPyproject || getFile("pyproject.toml"))?.content &&
				/\[tool\.poetry\]/i.test((rootPyproject || getFile("pyproject.toml"))?.content || ""))
		) {
			pyPm = "poetry";
			pyInstall = "poetry install --no-interaction";
		} else if (
			getRootFile("pipfile.lock") ||
			getRootFile("pipfile") ||
			getFile("pipfile.lock") ||
			getFile("pipfile")
		) {
			pyPm = "pipenv";
			pyInstall = "pipenv install --deploy";
		} else {
			pyPm = "pip";
			pyInstall = (rootReqs || getFile("requirements.txt"))
				? "pip install -r requirements.txt"
				: (rootSetupPy || getFile("setup.py"))
					? "pip install -e ."
					: "pip install -r requirements.txt";
		}

		const pythonVerFile = getRootFile(".python-version") || getFile(".python-version");
		const pyRuntime = resolvePythonRuntime({
			pythonVersionContent: pythonVerFile?.content,
			runtimeTxtContent: runtimeTxtFile?.content,
			pyprojectContent: (rootPyproject || getFile("pyproject.toml"))?.content,
			pipfileContent: (rootPipfile || getFile("pipfile"))?.content,
		});

		const combinedPyContent = [
			(rootReqs || getFile("requirements.txt"))?.content,
			(rootPyproject || getFile("pyproject.toml"))?.content,
			(rootPipfile || getFile("pipfile"))?.content,
			(rootSetupPy || getFile("setup.py"))?.content,
			(rootAppPy || getFile("app.py"))?.content,
			(rootMainPy || getFile("main.py"))?.content,
			(rootStreamlitAppPy || getFile("streamlit_app.py"))?.content,
		]
			.filter(Boolean)
			.join("\n")
			.toLowerCase();

		const hasStreamlitDep = combinedPyContent.includes("streamlit");
		const hasStreamlitFile = Boolean(rootStreamlitAppPy || getFile("streamlit_app.py"));
		const hasStreamlitCode = /import\s+streamlit|from\s+streamlit/i.test(combinedPyContent);

		if (hasStreamlitDep || hasStreamlitFile || hasStreamlitCode) {
			const entryFile = rootStreamlitAppPy
				? (rootStreamlitAppPy.name || "streamlit_app.py")
				: (rootAppPy || getFile("app.py"))
					? ((rootAppPy || getFile("app.py"))?.name || "app.py")
					: (rootMainPy || getFile("main.py"))
						? ((rootMainPy || getFile("main.py"))?.name || "main.py")
						: "app.py";

			return {
				framework: "Streamlit (Python)",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8501,
				bindHost: "0.0.0.0",
				packageManager: pyPm,
				installCommand: pyInstall,
				startCommand: `streamlit run ${entryFile} --server.port=8501 --server.address=0.0.0.0`,
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: hasStreamlitDep
					? "Detected Streamlit dependencies in requirements/manifest"
					: "Detected Streamlit entrypoint and code",
			};
		}

		if (combinedPyContent.includes("fastapi") || combinedPyContent.includes("uvicorn")) {
			const entry = (rootMainPy || getFile("main.py"))
				? "main:app"
				: (rootAppPy || getFile("app.py"))
					? "app:app"
					: "main:app";
			return {
				framework: "FastAPI",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8000,
				bindHost: "0.0.0.0",
				packageManager: pyPm,
				installCommand: pyInstall,
				startCommand: `uvicorn ${entry} --host 0.0.0.0 --port 8000`,
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: "Detected FastAPI dependencies in requirements/pyproject",
			};
		}

		if (combinedPyContent.includes("django") || Boolean(rootManagePy || getFile("manage.py"))) {
			return {
				framework: "Django",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8000,
				bindHost: "0.0.0.0",
				packageManager: pyPm,
				installCommand: pyInstall,
				startCommand: "python manage.py runserver 0.0.0.0:8000",
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: "Detected Django project manifest or manage.py",
			};
		}

		if (combinedPyContent.includes("flask")) {
			return {
				framework: "Flask",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 5000,
				bindHost: "0.0.0.0",
				packageManager: pyPm,
				installCommand: pyInstall,
				startCommand: "flask run --host=0.0.0.0 --port=5000",
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: "Detected Flask dependencies in requirements/pyproject",
			};
		}

		if (combinedPyContent.includes("gradio")) {
			const entry = (rootAppPy || getFile("app.py"))
				? ((rootAppPy || getFile("app.py"))?.name || "app.py")
				: (rootMainPy || getFile("main.py"))
					? ((rootMainPy || getFile("main.py"))?.name || "main.py")
					: "app.py";
			return {
				framework: "Gradio",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 7860,
				bindHost: "0.0.0.0",
				packageManager: pyPm,
				installCommand: pyInstall,
				startCommand: `python ${entry}`,
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: "Detected Gradio dependencies in requirements/pyproject",
			};
		}

		let pythonStart: string | undefined;
		if (rootMainPy || getFile("main.py")) {
			pythonStart = `python ${(rootMainPy || getFile("main.py"))?.name || "main.py"}`;
		} else if (rootAppPy || getFile("app.py")) {
			pythonStart = `python ${(rootAppPy || getFile("app.py"))?.name || "app.py"}`;
		} else if (getFile("server.py")) {
			pythonStart = "python server.py";
		} else if (getFile("wsgi.py")) {
			pythonStart = "gunicorn wsgi:application --bind 0.0.0.0:8000";
		}

		return {
			framework: "Python Application",
			language: "Python",
			buildType: "nixpacks",
			suggestedPort: 8000,
			bindHost: "0.0.0.0",
			packageManager: pyPm,
			installCommand: pyInstall,
			startCommand: pythonStart,
			runtimeVersion: pyRuntime.resolvedVersion,
			confidence: pythonStart ? "medium" : "low",
			reason: pythonStart
				? `Detected Python application with entrypoint (${pythonStart})`
				: "Detected Python project configuration",
		};
	}

	// 7. Java Projects (Maven, Gradle, Spring Boot)
	const pomXml = getFile("pom.xml");
	const buildGradle = getFile("build.gradle") || getFile("build.gradle.kts");
	const gradlew = getFile("gradlew");

	if (pomXml || buildGradle || gradlew) {
		const javaRuntime = resolveJavaRuntime({
			javaVersionContent: getFile(".java-version")?.content,
			pomXmlContent: pomXml?.content,
			gradleContent: buildGradle?.content,
		});

		const isMaven = Boolean(pomXml);
		const isGradle = Boolean(buildGradle || gradlew);
		const isSpringBoot =
			Boolean(pomXml?.content?.toLowerCase().includes("spring-boot")) ||
			Boolean(buildGradle?.content?.toLowerCase().includes("spring-boot"));

		const startCmd = isSpringBoot
			? isMaven
				? "java -jar target/*.jar"
				: "java -jar build/libs/*.jar"
			: undefined;

		return {
			framework: isSpringBoot
				? "Spring Boot"
				: isMaven
					? "Java (Maven)"
					: "Java (Gradle)",
			language: "Java",
			buildType: "nixpacks",
			suggestedPort: 8080,
			buildCommand: isMaven
				? "mvn clean package -DskipTests"
				: "./gradlew build -x test",
			startCommand: startCmd,
			runtimeVersion: `JDK ${javaRuntime.resolvedVersion}`,
			packageManager: isMaven ? "maven" : "gradle",
			confidence: "high",
			reason: isSpringBoot
				? "Detected Spring Boot application"
				: `Detected Java build configuration (${isMaven ? "pom.xml" : "Gradle"})`,
		};
	}

	// 8. .NET / C# Projects
	const csproj = Array.from(allFileMap.values()).find(
		(f) =>
			f.name.toLowerCase().endsWith(".csproj") ||
			f.path.toLowerCase().endsWith(".csproj"),
	);
	const globalJson = getFile("global.json");
	const slnFile = Array.from(allFileMap.values()).find((f) =>
		f.name.toLowerCase().endsWith(".sln"),
	);

	if (csproj || globalJson || slnFile) {
		const dotnetRuntime = resolveDotnetRuntime({
			globalJsonContent: globalJson?.content,
			csprojContent: csproj?.content,
		});

		return {
			framework: ".NET Application",
			language: "C#",
			buildType: "nixpacks",
			suggestedPort: 5000,
			buildCommand: "dotnet publish -c Release -o out",
			startCommand: "./out",
			runtimeVersion: `.NET SDK ${dotnetRuntime.resolvedVersion}`,
			packageManager: "dotnet",
			confidence: "high",
			reason: `Detected .NET project (${csproj?.name || slnFile?.name || "global.json"})`,
		};
	}

	// 9. Go Projects
	const goMod = getFile("go.mod");
	if (goMod) {
		const goRuntime = resolveGoRuntime({
			goVersionContent: getFile(".go-version")?.content,
			goModContent: goMod.content,
		});

		return {
			framework: "Go Application",
			language: "Go",
			buildType: "nixpacks",
			suggestedPort: 8080,
			buildCommand: "go build -o main .",
			startCommand: "./main",
			runtimeVersion: `Go ${goRuntime.resolvedVersion}`,
			packageManager: "go",
			confidence: "high",
			reason: `Detected Go module (go.mod: ${goRuntime.resolvedVersion})`,
		};
	}

	// 10. Rust Projects
	const cargoToml = getFile("cargo.toml");
	if (cargoToml) {
		const rustRuntime = resolveRustRuntime({
			rustToolchainContent:
				getFile("rust-toolchain.toml")?.content ||
				getFile("rust-toolchain")?.content,
			cargoTomlContent: cargoToml.content,
		});

		return {
			framework: "Rust Application",
			language: "Rust",
			buildType: "nixpacks",
			suggestedPort: 8080,
			buildCommand: "cargo build --release",
			startCommand: "cargo run --release",
			runtimeVersion: `Rust ${rustRuntime.resolvedVersion}`,
			packageManager: "cargo",
			confidence: "high",
			reason: "Detected Rust Cargo project (Cargo.toml)",
		};
	}

	// 11. PHP Projects
	const composer = getFile("composer.json");
	const indexPhp = getFile("index.php");
	if (composer?.content || indexPhp) {
		const phpRuntime = resolvePhpRuntime({
			phpVersionContent: getFile(".php-version")?.content,
			composerJsonContent: composer?.content,
		});

		const isLaravel = composer?.content?.toLowerCase().includes("laravel");
		const isSymfony = composer?.content?.toLowerCase().includes("symfony");

		return {
			framework: isLaravel
				? "Laravel"
				: isSymfony
					? "Symfony"
					: "PHP Application",
			language: "PHP",
			buildType: "nixpacks",
			suggestedPort: isLaravel ? 8000 : 80,
			startCommand: isLaravel
				? "php artisan serve --host=0.0.0.0 --port=8000"
				: "php -S 0.0.0.0:80",
			runtimeVersion: `PHP ${phpRuntime.resolvedVersion}`,
			packageManager: "composer",
			confidence: "high",
			reason: isLaravel
				? "Detected Laravel framework in composer.json"
				: isSymfony
					? "Detected Symfony framework in composer.json"
					: "Detected PHP application",
		};
	}

	// 12. Ruby Projects
	const gemfile = getFile("gemfile");
	if (gemfile?.content) {
		const rubyRuntime = resolveRubyRuntime({
			rubyVersionContent: getFile(".ruby-version")?.content,
			gemfileContent: gemfile.content,
		});

		const isRails = gemfile.content.toLowerCase().includes("rails");
		return {
			framework: isRails ? "Ruby on Rails" : "Ruby Application",
			language: "Ruby",
			buildType: "nixpacks",
			suggestedPort: 3000,
			startCommand: isRails
				? "bin/rails server -b 0.0.0.0 -p 3000"
				: "bundle exec rackup -o 0.0.0.0 -p 3000",
			runtimeVersion: `Ruby ${rubyRuntime.resolvedVersion}`,
			packageManager: "bundler",
			confidence: "high",
			reason: isRails
				? "Detected Ruby on Rails in Gemfile"
				: "Detected Ruby Gemfile",
		};
	}

	// 13. Static HTML site (root or subfolder without requiring Node.js)
	const indexHtml =
		getFile("index.html") ||
		getFile("public/index.html") ||
		getFile("dist/index.html") ||
		getFile("out/index.html") ||
		getFile("build/index.html");
	if (indexHtml) {
		let pubDir: string | undefined;
		const norm = indexHtml.path.replace(/^[/\\]+/, "").toLowerCase();
		if (norm.startsWith("public/")) pubDir = "public";
		else if (norm.startsWith("dist/")) pubDir = "dist";
		else if (norm.startsWith("out/")) pubDir = "out";
		else if (norm.startsWith("build/")) pubDir = "build";

		return {
			framework: "Static HTML",
			language: "HTML",
			buildType: "static",
			suggestedPort: 80,
			publishDirectory: pubDir,
			isStaticSpa: false,
			confidence: "high",
			reason: pubDir
				? `Detected static HTML assets with entry point in ${pubDir}/index.html`
				: "Detected static HTML assets with index.html at root",
		};
	}

	// 14. Nixpacks custom configuration (when no underlying framework was detected)
	if (nixpacksConfig) {
		const primaryProvider = nixpacksProviders[0];
		const lang = primaryProvider
			? primaryProvider.charAt(0).toUpperCase() + primaryProvider.slice(1)
			: "Nixpacks";
		return {
			framework: "Nixpacks Configured Project",
			language: lang,
			buildType: "nixpacks",
			suggestedPort: nixpacksPort || 3000,
			startCommand: nixpacksStartCmd,
			confidence: "high",
			reason: "Detected custom nixpacks.toml build configuration",
		};
	}

	// Fallback
	return {
		framework: "Generic Application",
		language: "Auto",
		buildType: "nixpacks",
		suggestedPort: 3000,
		confidence: "low",
		reason: "Default configuration recommended (Nixpacks auto-detection)",
	};
};

/**
 * Scan a directory on the server filesystem to detect application details
 */
export const detectFrameworkFromDirectory = async (
	dirPath: string,
): Promise<DetectionResult> => {
	try {
		if (!fs.existsSync(dirPath)) {
			return {
				framework: "Generic Application",
				language: "Auto",
				buildType: "nixpacks",
				suggestedPort: 3000,
				confidence: "low",
				reason: "Source directory not yet cloned; using sensible defaults",
			};
		}

		const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
		const files: FileEntry[] = [];

		for (const entry of entries) {
			if (entry.isFile()) {
				const filePath = path.join(dirPath, entry.name);
				let content: string | undefined;
				const lowerName = entry.name.toLowerCase();

				// Read configuration files for inspection
				if (
					[
						"package.json",
						"dockerfile",
						"docker-compose.yml",
						"docker-compose.yaml",
						"compose.yml",
						"compose.yaml",
						"requirements.txt",
						"pyproject.toml",
						"pipfile",
						"pipfile.lock",
						"poetry.lock",
						"uv.lock",
						"pdm.lock",
						"gemfile",
						"composer.json",
						"go.mod",
						"cargo.toml",
						"pom.xml",
						"build.gradle",
						"build.gradle.kts",
						"global.json",
						"pnpm-lock.yaml",
						"yarn.lock",
						"bun.lockb",
						"bun.lock",
						"package-lock.json",
						".nvmrc",
						".node-version",
						".python-version",
						".php-version",
						".ruby-version",
						".java-version",
						"next.config.js",
						"next.config.mjs",
						"next.config.ts",
						"index.html",
						"index.php",
					].includes(lowerName) ||
					lowerName.endsWith(".csproj") ||
					lowerName.endsWith(".sln")
				) {
					try {
						const stat = await fs.promises.stat(filePath);
						if (stat.size < 512 * 1024) {
							content = await fs.promises.readFile(filePath, "utf-8");
						}
					} catch {}
				}

				files.push({
					name: entry.name,
					path: entry.name,
					content,
				});
			}
		}

		const hasRootManifest = files.some((f) => isRecognizedProjectManifest(f.name));
		if (!hasRootManifest) {
			const { resolvedRoot } = resolveProjectRoot(dirPath);
			if (resolvedRoot) {
				const nestedPath = path.join(dirPath, resolvedRoot);
				if (fs.existsSync(nestedPath)) {
					const nestedResult = await detectFrameworkFromDirectory(nestedPath);
					nestedResult.projectRoot = resolvedRoot;
					return nestedResult;
				}
			}
		}

		return detectFrameworkFromFiles(files);
	} catch (error) {
		return {
			framework: "Generic Application",
			language: "Auto",
			buildType: "nixpacks",
			suggestedPort: 3000,
			confidence: "low",
			reason:
				error instanceof Error
					? `Inspection fallback: ${error.message}`
					: "Directory inspection fallback",
		};
	}
};

/**
 * Synchronously scan a directory on the server filesystem to detect application details
 */
export const detectFrameworkFromDirectorySync = (
	dirPath: string,
): DetectionResult => {
	try {
		if (!fs.existsSync(dirPath)) {
			return {
				framework: "Generic Application",
				language: "Auto",
				buildType: "nixpacks",
				suggestedPort: 3000,
				confidence: "low",
				reason: "Source directory does not exist; using sensible defaults",
			};
		}

		const entries = fs.readdirSync(dirPath, { withFileTypes: true });
		const files: FileEntry[] = [];

		for (const entry of entries) {
			if (entry.isFile()) {
				const filePath = path.join(dirPath, entry.name);
				let content: string | undefined;
				const lowerName = entry.name.toLowerCase();

				// Read configuration files for inspection
				if (
					[
						"package.json",
						"dockerfile",
						"dockerfile.production",
						"docker-compose.yml",
						"docker-compose.yaml",
						"compose.yml",
						"compose.yaml",
						"requirements.txt",
						"pyproject.toml",
						"pipfile",
						"pipfile.lock",
						"poetry.lock",
						"uv.lock",
						"pdm.lock",
						"setup.py",
						"setup.cfg",
						"gemfile",
						"composer.json",
						"go.mod",
						"cargo.toml",
						"pom.xml",
						"build.gradle",
						"build.gradle.kts",
						"global.json",
						"pnpm-lock.yaml",
						"yarn.lock",
						"bun.lockb",
						"bun.lock",
						"package-lock.json",
						".nvmrc",
						".node-version",
						".python-version",
						".php-version",
						".ruby-version",
						".java-version",
						"next.config.js",
						"next.config.mjs",
						"next.config.ts",
						"index.html",
						"index.php",
						"app.py",
						"main.py",
						"streamlit_app.py",
						"manage.py",
						"server.py",
					].includes(lowerName) ||
					lowerName.endsWith(".csproj") ||
					lowerName.endsWith(".sln")
				) {
					try {
						const stat = fs.statSync(filePath);
						if (stat.size < 512 * 1024) {
							content = fs.readFileSync(filePath, "utf-8");
						}
					} catch {}
				}

				files.push({
					name: entry.name,
					path: entry.name,
					content,
				});
			}
		}

		const hasRootManifest = files.some((f) => isRecognizedProjectManifest(f.name));
		if (!hasRootManifest) {
			const { resolvedRoot } = resolveProjectRoot(dirPath);
			if (resolvedRoot) {
				const nestedPath = path.join(dirPath, resolvedRoot);
				if (fs.existsSync(nestedPath)) {
					const nestedResult = detectFrameworkFromDirectorySync(nestedPath);
					nestedResult.projectRoot = resolvedRoot;
					return nestedResult;
				}
			}
		}

		return detectFrameworkFromFiles(files);
	} catch (error) {
		return {
			framework: "Generic Application",
			language: "Auto",
			buildType: "nixpacks",
			suggestedPort: 3000,
			confidence: "low",
			reason:
				error instanceof Error
					? `Inspection fallback: ${error.message}`
					: "Directory inspection fallback",
		};
	}
};

/**
 * Inspect an existing application entity by checking its cloned repository code or configuration
 */
export const inspectApplication = async (
	applicationId: string,
): Promise<ApplicationInspection> => {
	const app = await findApplicationById(applicationId);
	let detected: DetectionResult;

	const appPath =
		process.env.APPLICATIONS_PATH ||
		(process.platform === "win32"
			? "C:\\dokploy\\apps"
			: "/etc/dokploy/applications");
	const codeDir = path.join(appPath, app.appName, "code");

	const targetDir =
		app.buildPath && app.buildPath !== "/"
			? path.join(codeDir, app.buildPath.replace(/^[/\\]+/, ""))
			: codeDir;

	if (fs.existsSync(targetDir)) {
		detected = await detectFrameworkFromDirectory(targetDir);
	} else if (
		app.sourceType === "github" &&
		app.githubId &&
		app.owner &&
		app.repository
	) {
		try {
			const { findGithubById } = await import("./github");
			const { authGithub } = await import("../utils/providers/github");
			const gh = await findGithubById(app.githubId);
			if (gh) {
				const octokit = authGithub(gh);
				const repoPath =
					app.buildPath && app.buildPath !== "/"
						? app.buildPath.replace(/^[/\\]+/, "")
						: "";
				const { data: contents } = await octokit.rest.repos.getContent({
					owner: app.owner,
					repo: app.repository,
					path: repoPath,
					ref: app.branch || undefined,
				});

				if (Array.isArray(contents)) {
					const files: FileEntry[] = [];
					const checkFileNames = [
						"package.json",
						"dockerfile",
						"docker-compose.yml",
						"docker-compose.yaml",
						"compose.yml",
						"compose.yaml",
						"requirements.txt",
						"pyproject.toml",
						"pipfile",
						"gemfile",
						"composer.json",
						"go.mod",
						"cargo.toml",
						"pom.xml",
						"build.gradle",
						"global.json",
						"index.html",
						"pnpm-lock.yaml",
						"yarn.lock",
						"bun.lockb",
						"bun.lock",
						"package-lock.json",
						".nvmrc",
						".node-version",
						".python-version",
					];

					for (const item of contents) {
						if (item.type === "file") {
							let content: string | undefined;
							if (
								(checkFileNames.includes(item.name.toLowerCase()) ||
									item.name.toLowerCase().endsWith(".csproj")) &&
								item.size < 100 * 1024
							) {
								try {
									const fileRes = await octokit.rest.repos.getContent({
										owner: app.owner,
										repo: app.repository,
										path: item.path,
										ref: app.branch || undefined,
									});
									if ("content" in fileRes.data && fileRes.data.content) {
										content = Buffer.from(
											fileRes.data.content,
											"base64",
										).toString("utf-8");
									}
								} catch {}
							}
							files.push({ name: item.name, path: item.path, content });
						}
					}

					if (files.length > 0) {
						detected = detectFrameworkFromFiles(files);
					} else {
						detected = {
							framework: "Auto-detected Application",
							language: "Auto",
							buildType:
								(app.buildType as BuildTypeRecommendation) || "nixpacks",
							suggestedPort: 3000,
							confidence: "medium",
							reason: "Standard Nixpacks cloud builder",
						};
					}
				} else {
					detected = {
						framework: "Auto-detected Application",
						language: "Auto",
						buildType: (app.buildType as BuildTypeRecommendation) || "nixpacks",
						suggestedPort: 3000,
						confidence: "medium",
						reason: "Standard Nixpacks cloud builder",
					};
				}
			} else {
				detected = {
					framework: "Auto-detected Application",
					language: "Auto",
					buildType: (app.buildType as BuildTypeRecommendation) || "nixpacks",
					suggestedPort: 3000,
					confidence: "medium",
					reason: "Standard Nixpacks cloud builder",
				};
			}
		} catch {
			detected = {
				framework: "Auto-detected Application",
				language: "Auto",
				buildType: (app.buildType as BuildTypeRecommendation) || "nixpacks",
				suggestedPort: 3000,
				confidence: "medium",
				reason: "Standard Nixpacks cloud builder",
			};
		}
	} else if (app.buildType === "dockerfile") {
		detected = {
			framework: "Dockerfile",
			language: "Docker",
			buildType: "dockerfile",
			suggestedPort: 3000,
			confidence: "high",
			reason: "Configured to build using Dockerfile",
		};
	} else {
		detected = {
			framework: "Auto-detected Application",
			language: "Auto",
			buildType: (app.buildType as BuildTypeRecommendation) || "nixpacks",
			suggestedPort: 3000,
			confidence: "medium",
			reason: "Standard Nixpacks cloud builder",
		};
	}

	return {
		applicationId: app.applicationId,
		appName: app.appName,
		detected,
		isLiveReady: app.applicationStatus === "done",
		sourceType: app.sourceType || "github",
		healthRecommendation: {
			checkPath: "/",
			expectedPort: detected.suggestedPort,
		},
	};
};
