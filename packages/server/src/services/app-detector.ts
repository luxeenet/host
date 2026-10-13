import fs from "node:fs";
import path from "node:path";
import {
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
 * builder, start/build commands, runtime versions, and default container ports.
 */
export const detectFrameworkFromFiles = (
	files: FileEntry[],
): DetectionResult => {
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

	// 3. Check for explicit nixpacks.toml configuration
	const nixpacksConfig = getFile("nixpacks.toml");
	if (nixpacksConfig) {
		return {
			framework: "Nixpacks Configured Project",
			language: "Nixpacks",
			buildType: "nixpacks",
			suggestedPort: 3000,
			confidence: "high",
			reason: "Detected custom nixpacks.toml build configuration",
		};
	}

	// 4. Check for Cloud Native Buildpacks project.toml
	const projectToml = getFile("project.toml");
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

	// File items for JS package manager resolution
	const fileItems = Array.from(fileMap.values()).map((f) => ({
		name: f.name || path.basename(f.path),
		path: f.path,
		content: f.content,
	}));

	const pkgFile = getFile("package.json");
	const nvmrcFile = getFile(".nvmrc");
	const nodeVersionFile = getFile(".node-version");
	const runtimeTxtFile = getFile("runtime.txt");

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
	if (pkgFile?.content) {
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
					isStaticSpa: true,
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
					runtimeVersion: nodeRuntime.resolvedVersion,
					packageManager,
					confidence: "medium",
					reason: "Detected Node.js project with start script",
				};
			}
		} catch {}
	}

	// 6. Python Projects
	const reqs =
		getFile("requirements.txt") ||
		getFile("pyproject.toml") ||
		getFile("pipfile") ||
		getFile("pipfile.lock") ||
		getFile("poetry.lock") ||
		getFile("uv.lock") ||
		getFile("pdm.lock");

	if (reqs?.content || getFile("main.py") || getFile(".python-version")) {
		const pythonVerFile = getFile(".python-version");
		const pyRuntime = resolvePythonRuntime({
			pythonVersionContent: pythonVerFile?.content,
			runtimeTxtContent: runtimeTxtFile?.content,
			pyprojectContent: getFile("pyproject.toml")?.content,
			pipfileContent: getFile("pipfile")?.content,
		});

		const lower = (reqs?.content || "").toLowerCase();
		if (lower.includes("fastapi") || lower.includes("uvicorn")) {
			return {
				framework: "FastAPI",
				language: "Python",
				buildType: "nixpacks",
				suggestedPort: 8000,
				startCommand: "uvicorn main:app --host 0.0.0.0 --port 8000",
				runtimeVersion: pyRuntime.resolvedVersion,
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
				runtimeVersion: pyRuntime.resolvedVersion,
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
				runtimeVersion: pyRuntime.resolvedVersion,
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
				runtimeVersion: pyRuntime.resolvedVersion,
				confidence: "high",
				reason: "Detected Streamlit dependencies",
			};
		}

		return {
			framework: "Python Application",
			language: "Python",
			buildType: "nixpacks",
			suggestedPort: 8000,
			runtimeVersion: pyRuntime.resolvedVersion,
			confidence: "medium",
			reason: "Detected Python project configuration",
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
			runtimeVersion: `JDK ${javaRuntime.resolvedVersion}`,
			packageManager: isMaven ? "maven" : "gradle",
			confidence: "high",
			reason: isSpringBoot
				? "Detected Spring Boot application"
				: `Detected Java build configuration (${isMaven ? "pom.xml" : "Gradle"})`,
		};
	}

	// 8. .NET / C# Projects
	const csproj = Array.from(fileMap.values()).find(
		(f) =>
			f.name.toLowerCase().endsWith(".csproj") ||
			f.path.toLowerCase().endsWith(".csproj"),
	);
	const globalJson = getFile("global.json");
	const slnFile = Array.from(fileMap.values()).find((f) =>
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
			suggestedPort: 80,
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
