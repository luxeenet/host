import fs from "node:fs";
import path from "node:path";
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
	| "compose";

export interface DetectionResult {
	framework: string;
	language: string;
	buildType: BuildTypeRecommendation;
	suggestedPort: number;
	buildCommand?: string;
	startCommand?: string;
	publishDirectory?: string;
	dockerfilePath?: string;
	packageManager?: "npm" | "pnpm" | "yarn" | "bun";
	confidence: "high" | "medium" | "low";
	reason: string;
	suggestedEnv?: Array<{ key: string; description: string; required: boolean }>;
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

/**
 * Deterministically inspect a virtual or physical list of files to detect framework,
 * builder, start/build commands, and default container ports without requiring AI.
 */
export const detectFrameworkFromFiles = (files: FileEntry[]): DetectionResult => {
	const fileMap = new Map<string, FileEntry>();
	for (const file of files) {
		const normPath = file.path.replace(/^[/\\]+/, "").toLowerCase();
		const baseName = (file.name || path.basename(file.path)).toLowerCase();
		fileMap.set(normPath, file);
		fileMap.set(baseName, file);
	}

	const getFile = (name: string): FileEntry | undefined => {
		const lower = name.toLowerCase();
		return fileMap.get(lower);
	};

	// 1. Check for Docker Compose
	const composeFile =
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
	const dockerfile = getFile("dockerfile") || getFile("dockerfile.production");
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

	// Package Manager detection
	let packageManager: "npm" | "pnpm" | "yarn" | "bun" = "npm";
	if (getFile("pnpm-lock.yaml")) {
		packageManager = "pnpm";
	} else if (getFile("yarn.lock")) {
		packageManager = "yarn";
	} else if (getFile("bun.lockb") || getFile("bun.lock")) {
		packageManager = "bun";
	}

	const runPrefix =
		packageManager === "pnpm"
			? "pnpm"
			: packageManager === "yarn"
				? "yarn"
				: packageManager === "bun"
					? "bun run"
					: "npm run";

	// 3. Node.js / JavaScript / TypeScript projects (package.json)
	const pkgFile = getFile("package.json");
	if (pkgFile?.content) {
		try {
			const pkg = JSON.parse(pkgFile.content);
			const allDeps = {
				...(pkg.dependencies || {}),
				...(pkg.devDependencies || {}),
			};
			const scripts = pkg.scripts || {};

			// Next.js
			if (allDeps.next) {
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
					packageManager,
					confidence: "high",
					reason: "Detected NestJS in package.json dependencies",
				};
			}

			// Vite (React / Vue / Svelte SPA or preview)
			if (allDeps.vite) {
				const spaType = allDeps.react
					? "React"
					: allDeps.vue
						? "Vue"
						: allDeps.svelte
							? "Svelte"
							: "Web";
				return {
					framework: `Vite (${spaType})`,
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 4173,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.preview
						? `${runPrefix} preview -- --port 4173 --host 0.0.0.0`
						: undefined,
					publishDirectory: "dist",
					packageManager,
					confidence: "high",
					reason: `Detected Vite (${spaType}) frontend in package.json`,
				};
			}

			// Express / Fastify / Koa / Hono
			if (allDeps.express || allDeps.fastify || allDeps.koa || allDeps.hono) {
				const fwName = allDeps.express
					? "Express"
					: allDeps.fastify
						? "Fastify"
						: allDeps.koa
							? "Koa"
							: "Hono";
				return {
					framework: `Node.js (${fwName})`,
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start
						? packageManager === "bun"
							? "bun start"
							: `${packageManager} start`
						: pkg.main
							? `node ${pkg.main}`
							: "node index.js",
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

			// Generic Node.js with start script
			if (scripts.start || pkg.main) {
				return {
					framework: "Node.js Application",
					language: allDeps.typescript ? "TypeScript" : "JavaScript",
					buildType: "nixpacks",
					suggestedPort: 3000,
					buildCommand: scripts.build ? `${runPrefix} build` : undefined,
					startCommand: scripts.start
						? `${runPrefix} start`
						: `node ${pkg.main || "index.js"}`,
					packageManager,
					confidence: "medium",
					reason: "Detected Node.js project with start script",
				};
			}
		} catch {
			// fallback if package.json cannot be parsed
		}
	}

	// 4. Python Projects
	const reqs = getFile("requirements.txt") || getFile("pyproject.toml");
	if (reqs?.content) {
		const lower = reqs.content.toLowerCase();
		if (lower.includes("fastapi") || lower.includes("uvicorn")) {
			return {
				framework: "FastAPI",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8000,
				startCommand: "uvicorn main:app --host 0.0.0.0 --port 8000",
				confidence: "high",
				reason: "Detected FastAPI dependencies in requirements/pyproject",
			};
		}
		if (lower.includes("django")) {
			return {
				framework: "Django",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8000,
				startCommand: "python manage.py runserver 0.0.0.0:8000",
				confidence: "high",
				reason: "Detected Django dependencies in requirements/pyproject",
			};
		}
		if (lower.includes("flask")) {
			return {
				framework: "Flask",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 5000,
				startCommand: "flask run --host=0.0.0.0 --port=5000",
				confidence: "high",
				reason: "Detected Flask dependencies in requirements/pyproject",
			};
		}
		if (lower.includes("streamlit")) {
			return {
				framework: "Streamlit",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8501,
				startCommand:
					"streamlit run app.py --server.port=8501 --server.address=0.0.0.0",
				confidence: "high",
				reason: "Detected Streamlit dependencies",
			};
		}

		return {
			framework: "Python Application",
			language: "Python",
			buildType: "nixpacks",
			suggestedPort: 8000,
			confidence: "medium",
			reason: "Detected Python requirements configuration",
		};
	}

	// 5. Go Projects
	const goMod = getFile("go.mod");
	if (goMod) {
		return {
			framework: "Go Application",
			language: "Go",
			buildType: "nixpacks",
			suggestedPort: 8080,
			confidence: "high",
			reason: "Detected Go module (go.mod)",
		};
	}

	// 6. Rust Projects
	const cargoToml = getFile("cargo.toml");
	if (cargoToml) {
		return {
			framework: "Rust Application",
			language: "Rust",
			buildType: "nixpacks",
			suggestedPort: 8080,
			confidence: "high",
			reason: "Detected Rust Cargo project (Cargo.toml)",
		};
	}

	// 7. PHP Projects
	const composer = getFile("composer.json");
	const indexPhp = getFile("index.php");
	if (composer?.content || indexPhp) {
		const isLaravel = composer?.content?.toLowerCase().includes("laravel");
		return {
			framework: isLaravel ? "Laravel" : "PHP Application",
			language: "PHP",
			buildType: "nixpacks",
			suggestedPort: 80,
			confidence: "high",
			reason: isLaravel
				? "Detected Laravel framework in composer.json"
				: "Detected PHP application",
		};
	}

	// 8. Ruby Projects
	const gemfile = getFile("gemfile");
	if (gemfile?.content) {
		const isRails = gemfile.content.toLowerCase().includes("rails");
		return {
			framework: isRails ? "Ruby on Rails" : "Ruby Application",
			language: "Ruby",
			buildType: "nixpacks",
			suggestedPort: 3000,
			confidence: "high",
			reason: isRails ? "Detected Ruby on Rails in Gemfile" : "Detected Ruby Gemfile",
		};
	}

	// 9. Static HTML site
	const indexHtml = getFile("index.html");
	if (indexHtml) {
		return {
			framework: "Static HTML",
			language: "HTML",
			buildType: "static",
			suggestedPort: 80,
			confidence: "high",
			reason: "Detected static HTML assets with index.html",
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
				// Read small configuration files for inspection
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
						"gemfile",
						"composer.json",
						"go.mod",
						"cargo.toml",
						"pnpm-lock.yaml",
						"yarn.lock",
						"bun.lockb",
						"bun.lock",
						"index.html",
						"index.php",
					].includes(entry.name.toLowerCase())
				) {
					try {
						const stat = await fs.promises.stat(filePath);
						if (stat.size < 512 * 1024) {
							content = await fs.promises.readFile(filePath, "utf-8");
						}
					} catch {
						// ignore unreadable files
					}
				}

				files.push({
					name: entry.name,
					path: entry.name,
					content,
				});
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

	// In dokploy, cloned code is placed in APPLICATIONS_PATH/appName/code or custom paths
	const appPath =
		process.env.APPLICATIONS_PATH ||
		(process.platform === "win32" ? "C:\\dokploy\\apps" : "/etc/dokploy/applications");
	const codeDir = path.join(appPath, app.appName, "code");

	if (fs.existsSync(codeDir)) {
		detected = await detectFrameworkFromDirectory(codeDir);
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
