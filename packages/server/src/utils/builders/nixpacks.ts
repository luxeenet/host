import fs from "node:fs";
import path from "node:path";
import {
	detectFrameworkFromDirectorySync,
	extractPortFromCommand,
} from "@dokploy/server/services/app-detector";
import { getStaticCommand } from "@dokploy/server/utils/builders/static";
import { nanoid } from "nanoid";
import { quote } from "shell-quote";
import { prepareEnvironmentVariablesForShell } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";
import { NIXPKGS_ARCHIVES } from "./runtime-catalog";
import {
	generateNixpacksToml,
	resolveNodeRuntime,
	resolvePackageManagerAndCommands,
} from "./runtime-resolver";

export const getNixpacksCommand = (application: ApplicationNested) => {
	const { env, appName, publishDirectory, cleanCache, command: customerCommand } = application;

	const buildAppDirectory = getBuildAppDirectory(application);
	const buildContainerId = `${appName}-${nanoid(10)}`;
	const envVariables = prepareEnvironmentVariablesForShell(
		env,
		application.environment.project.env,
		application.environment.env,
	);

	const args = ["build", buildAppDirectory, "--name", appName];

	if (cleanCache) {
		args.push("--no-cache");
	}

	for (const env of envVariables) {
		args.push("--env", env);
	}

	// Always ensure NIXPACKS_PATH and HOST are initialized to avoid BuildKit UndefinedVar warnings and binding issues
	const hasNixpacksPath = envVariables.some((e) =>
		e.startsWith("NIXPACKS_PATH="),
	);
	if (!hasNixpacksPath) {
		args.push("--env", "NIXPACKS_PATH=");
	}

	const hasHostEnv = envVariables.some((e) => e.startsWith("HOST="));
	if (!hasHostEnv) {
		args.push("--env", "HOST=0.0.0.0");
		args.push("--env", "NIXPACKS_HOST=0.0.0.0");
	}

	// Static host inspection if the directory already exists on host
	let preResolvedNodeEnv: string | undefined;
	let preResolvedInstallCmd: string | undefined;
	let preResolvedBuildCmd: string | undefined;
	let preResolvedStartCmd: string | undefined;
	let preResolvedArchive: string | undefined;
	let preResolvedProvider: string | undefined;
	let preResolvedPort: number | undefined;
	let preResolvedSetupCmds: string[] | undefined;
	let preResolvedPythonVersion: string | undefined;

	if (fs.existsSync(buildAppDirectory)) {
		try {
			const detected = detectFrameworkFromDirectorySync(buildAppDirectory);

			if (detected.language === "Python") {
				preResolvedProvider = "python";
				preResolvedPythonVersion = detected.runtimeVersion || "3.11";
				preResolvedInstallCmd =
					detected.installCommand ||
					"test -f /opt/venv/bin/pip && /opt/venv/bin/pip install -r requirements.txt || python3 -m pip install -r requirements.txt || pip install -r requirements.txt";
				preResolvedStartCmd = detected.startCommand;
				preResolvedBuildCmd = detected.buildCommand;
				preResolvedPort = detected.suggestedPort || 8501;
				preResolvedSetupCmds = [
					"python3 -m venv --copies /opt/venv 2>/dev/null || python -m venv --copies /opt/venv || true",
					"/opt/venv/bin/python -m ensurepip --upgrade 2>/dev/null || true",
				];
			} else if (detected.language === "Go") {
				preResolvedProvider = "go";
				preResolvedStartCmd = detected.startCommand;
				preResolvedBuildCmd = detected.buildCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 8080;
			} else if (detected.language === "Rust") {
				preResolvedProvider = "rust";
				preResolvedStartCmd = detected.startCommand;
				preResolvedBuildCmd = detected.buildCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 8080;
			} else if (detected.language === "Java") {
				preResolvedProvider = "java";
				preResolvedStartCmd = detected.startCommand;
				preResolvedBuildCmd = detected.buildCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 8080;
			} else if (detected.language === "PHP") {
				preResolvedProvider = "php";
				preResolvedStartCmd = detected.startCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 80;
			} else if (detected.language === "Ruby") {
				preResolvedProvider = "ruby";
				preResolvedStartCmd = detected.startCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 3000;
			} else if (detected.language === "C#" || detected.language === ".NET") {
				preResolvedProvider = "dotnet";
				preResolvedStartCmd = detected.startCommand;
				preResolvedBuildCmd = detected.buildCommand;
				preResolvedInstallCmd = detected.installCommand;
				preResolvedPort = detected.suggestedPort || 5000;
			} else {
				let pkgContent: string | undefined;
				let nvmrcContent: string | undefined;
				let nodeVersionContent: string | undefined;
				let runtimeTxtContent: string | undefined;

				const pkgPath = path.join(buildAppDirectory, "package.json");
				const nvmrcPath = path.join(buildAppDirectory, ".nvmrc");
				const nodeVerPath = path.join(buildAppDirectory, ".node-version");
				const runtimeTxtPath = path.join(buildAppDirectory, "runtime.txt");

				if (fs.existsSync(pkgPath)) {
					pkgContent = fs.readFileSync(pkgPath, "utf-8");
					preResolvedProvider = "node";
				}
				if (fs.existsSync(nvmrcPath)) {
					nvmrcContent = fs.readFileSync(nvmrcPath, "utf-8");
				}
				if (fs.existsSync(nodeVerPath)) {
					nodeVersionContent = fs.readFileSync(nodeVerPath, "utf-8");
				}
				if (fs.existsSync(runtimeTxtPath)) {
					runtimeTxtContent = fs.readFileSync(runtimeTxtPath, "utf-8");
				}

				const runtime = resolveNodeRuntime({
					packageJsonContent: pkgContent,
					nvmrcContent,
					nodeVersionContent,
					runtimeTxtContent,
				});

				preResolvedNodeEnv = runtime.resolvedVersion;
				if (runtime.nixpkgsArchive) {
					preResolvedArchive = runtime.nixpkgsArchive;
				}

				const files = fs.readdirSync(buildAppDirectory).map((name) => ({
					name,
					path: path.join(buildAppDirectory, name),
				}));

				const pm = resolvePackageManagerAndCommands({
					files,
					packageJsonContent: pkgContent,
				});

				preResolvedInstallCmd = pm.installCommand;
				preResolvedBuildCmd = pm.buildCommand;
				preResolvedStartCmd = pm.startCommand;
				preResolvedPort = detected.suggestedPort || 3000;

				// Native optional binding remediation for Rolldown / Vite 8 on cross-platform lockfiles (npm/cli#4828)
				if (pkgContent) {
					try {
						const parsedPkg = JSON.parse(pkgContent);
						const allDeps = {
							...(parsedPkg.dependencies || {}),
							...(parsedPkg.devDependencies || {}),
						};
						if (allDeps.rolldown || (allDeps.vite && /^[\^~]?[89]/.test(allDeps.vite))) {
							const rolldownFix =
								'ARCH=$(uname -m 2>/dev/null || echo "x86_64"); case "$ARCH" in aarch64|arm64) BINDING_PKG="@rolldown/binding-linux-arm64-gnu" ;; *) BINDING_PKG="@rolldown/binding-linux-x64-gnu" ;; esac; if [ -d "node_modules/rolldown" ] && [ ! -d "node_modules/$BINDING_PKG" ]; then R_VER=$(node -e "try{console.log(require(\"./node_modules/rolldown/package.json\").version)}catch(e){}" 2>/dev/null || echo ""); if [ -n "$R_VER" ]; then TARGET="${BINDING_PKG}@${R_VER}"; else TARGET="$BINDING_PKG"; fi; echo "⚡ HatDot detected missing Rolldown Linux native binding in cross-platform lockfile. Installing $TARGET into container..." && (npm i "$TARGET" --no-save || { echo "❌ Failed to install required Rolldown native binding: $TARGET" >&2; exit 1; }); fi';
							preResolvedBuildCmd = preResolvedBuildCmd
								? `${rolldownFix}; ${preResolvedBuildCmd}`
								: `${rolldownFix}; npm run build`;
						}
					} catch {}
				}
			}

			// Write or augment nixpacks.toml with pinned archive, isolated provider, and start command
			const effectiveStart = customerCommand?.trim() || preResolvedStartCmd;
			const nixpacksTomlPath = path.join(buildAppDirectory, "nixpacks.toml");
			if (!fs.existsSync(nixpacksTomlPath)) {
				fs.writeFileSync(
					nixpacksTomlPath,
					generateNixpacksToml({
						nixpkgsArchive: preResolvedArchive,
						providers: preResolvedProvider ? [preResolvedProvider] : undefined,
						setupCmds: preResolvedSetupCmds,
						installCmd: preResolvedInstallCmd,
						buildCmd: preResolvedBuildCmd,
						startCmd: effectiveStart,
					}),
					"utf-8",
				);
			} else if (preResolvedProvider) {
				try {
					const existingToml = fs.readFileSync(nixpacksTomlPath, "utf-8");
					let updatedToml = existingToml;
					if (!updatedToml.includes("providers")) {
						updatedToml = `providers = ["${preResolvedProvider}"]\n\n${updatedToml}`;
					}
					if (preResolvedArchive && !updatedToml.includes("nixpkgsArchive")) {
						updatedToml += `\n\n[phases.setup]\nnixpkgsArchive = "${preResolvedArchive}"\n`;
					}
					if (preResolvedSetupCmds && preResolvedSetupCmds.length > 0 && !updatedToml.includes("cmds")) {
						updatedToml += `\n[phases.setup]\ncmds = [${preResolvedSetupCmds.map((c) => JSON.stringify(c)).join(", ")}]\n`;
					}
					if (updatedToml !== existingToml) {
						fs.writeFileSync(nixpacksTomlPath, updatedToml, "utf-8");
					}
				} catch {}
			}
		} catch {}
	}

	// Only add flags if not explicitly overridden by customer in envVariables
	const hasCustomerNodeVersion = envVariables.some((e) =>
		e.startsWith("NIXPACKS_NODE_VERSION="),
	);
	const hasCustomerInstallCmd = envVariables.some((e) =>
		e.startsWith("NIXPACKS_INSTALL_CMD="),
	);
	const hasCustomerBuildCmd = envVariables.some((e) =>
		e.startsWith("NIXPACKS_BUILD_CMD="),
	);
	const hasCustomerStartCmd = envVariables.some((e) =>
		e.startsWith("NIXPACKS_START_CMD="),
	);
	const hasCustomerArchive = envVariables.some(
		(e) =>
			e.startsWith("NIXPACKS_PKGS_ARCHIVE=") ||
			e.startsWith("NIXPACKS_NIXPKGS_ARCHIVE="),
	);

	// Explicit customer-provided start command takes precedence over inferred commands
	const activeStartCommand = customerCommand?.trim() || preResolvedStartCmd;

	let effectiveProvider = preResolvedProvider;
	if (!effectiveProvider && activeStartCommand) {
		if (
			activeStartCommand.includes("streamlit") ||
			activeStartCommand.includes("uvicorn") ||
			activeStartCommand.includes("gunicorn") ||
			activeStartCommand.includes("flask") ||
			activeStartCommand.includes("manage.py")
		) {
			effectiveProvider = "python";
		}
	}

	let effectivePort: number | undefined;
	const cmdPort = extractPortFromCommand(activeStartCommand);
	if (cmdPort) {
		effectivePort = cmdPort;
	} else if (preResolvedPort) {
		effectivePort = preResolvedPort;
	} else if (effectiveProvider === "python") {
		effectivePort = 8501;
	} else if (activeStartCommand && /\bpreview\b/i.test(activeStartCommand)) {
		effectivePort = 4173;
	} else {
		effectivePort = 3000;
	}

	let effectiveInstallCmd = preResolvedInstallCmd;
	if (!effectiveInstallCmd && effectiveProvider === "python") {
		effectiveInstallCmd = "pip install -r requirements.txt";
	}

	if (preResolvedNodeEnv && !hasCustomerNodeVersion) {
		args.push("--env", `NIXPACKS_NODE_VERSION=${preResolvedNodeEnv}`);
	}

	if (preResolvedPythonVersion && !envVariables.some((e) => e.startsWith("NIXPACKS_PYTHON_VERSION="))) {
		args.push("--env", `NIXPACKS_PYTHON_VERSION=${preResolvedPythonVersion}`);
	}

	if (preResolvedArchive && !hasCustomerArchive) {
		args.push("--env", `NIXPACKS_PKGS_ARCHIVE=${preResolvedArchive}`);
		args.push("--env", `NIXPACKS_NIXPKGS_ARCHIVE=${preResolvedArchive}`);
	}

	if (effectiveInstallCmd && !hasCustomerInstallCmd) {
		args.push(
			"--env",
			`NIXPACKS_INSTALL_CMD=${quote([effectiveInstallCmd])}`,
		);
	}

	if (preResolvedBuildCmd && !hasCustomerBuildCmd) {
		args.push("--env", `NIXPACKS_BUILD_CMD=${quote([preResolvedBuildCmd])}`);
	}

	if (effectivePort) {
		const hasPortEnv = envVariables.some((e) => e.startsWith("PORT="));
		if (!hasPortEnv) {
			args.push("--env", `PORT=${effectivePort}`);
			args.push("--env", `NIXPACKS_PORT=${effectivePort}`);
		}
	}

	if (activeStartCommand && !hasCustomerStartCmd) {
		args.push("--start-cmd", quote([activeStartCommand]));
		args.push("--env", `NIXPACKS_START_CMD=${quote([activeStartCommand])}`);
	}

	// Note: We DO NOT pass '--provider' to the Nixpacks CLI, because nixpacks build does not support --provider flag.
	// Provider selection in Nixpacks is supported solely via nixpacks.toml or automatic detection.
	if (effectiveProvider) {
		args.push("--env", `NIXPACKS_PROVIDER=${quote([effectiveProvider])}`);
	}

	if (publishDirectory) {
		/* No need for any start command, since we'll use nginx later on */
		args.push("--no-error-without-start");
	}

	const command = `nixpacks ${args.join(" ")}`;

	// Pinned Nixpkgs archive hashes
	const archive2405 = NIXPKGS_ARCHIVES.LEGACY_24_05.commit;
	const archive2311 = NIXPKGS_ARCHIVES.LEGACY_23_11.commit;
	const archive2213 = NIXPKGS_ARCHIVES.MODERN_22_13.commit;
	const archive2411 = NIXPKGS_ARCHIVES.MODERN_24_11.commit;

	// Shell preflight ensures runtime compatibility even if repository was cloned inside the deploy bash script
	const preflightShell = `
# HatDot Runtime Compatibility & Nixpacks Preflight
# Safe environment variable initialization
export NIXPACKS_PATH="\${NIXPACKS_PATH:-}"
export HOST="\${HOST:-0.0.0.0}"
export NIXPACKS_HOST="\${NIXPACKS_HOST:-0.0.0.0}"

if [ -d ${quote([buildAppDirectory])} ]; then
  # Pure Python detection in preflight shell
  if [ -f "${buildAppDirectory}/requirements.txt" ] || [ -f "${buildAppDirectory}/pyproject.toml" ] || [ -f "${buildAppDirectory}/Pipfile" ] || [ -f "${buildAppDirectory}/app.py" ] || [ -f "${buildAppDirectory}/streamlit_app.py" ]; then
    if [ ! -f "${buildAppDirectory}/package.json" ]; then
      export NIXPACKS_PROVIDER="python"
      echo "✓ HatDot detected pure Python application. Enforcing Python provider (disabling Node/npm)." ;

      DETECTED_PYTHON=""
      if [ -f "${buildAppDirectory}/.python-version" ]; then
        DETECTED_PYTHON=$(cat "${buildAppDirectory}/.python-version" | tr -d 'v\\r\\n ' | cut -d. -f1,2)
      elif [ -f "${buildAppDirectory}/runtime.txt" ]; then
        DETECTED_PYTHON=$(cat "${buildAppDirectory}/runtime.txt" | sed -E 's/^python[-_]?//I' | tr -d 'v\\r\\n ' | cut -d. -f1,2)
      fi
      if [ -n "$DETECTED_PYTHON" ]; then
        export NIXPACKS_PYTHON_VERSION="$DETECTED_PYTHON"
      fi

      if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
        printf 'providers = ["python"]\n\n[phases.setup]\ncmds = ["python3 -m venv --copies /opt/venv 2>/dev/null || python -m venv --copies /opt/venv || true", "/opt/venv/bin/python -m ensurepip --upgrade 2>/dev/null || true"]\n' > "${buildAppDirectory}/nixpacks.toml" ;
      elif ! grep -q "providers" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
        printf '\nproviders = ["python"]\n\n[phases.setup]\ncmds = ["python3 -m venv --copies /opt/venv 2>/dev/null || python -m venv --copies /opt/venv || true", "/opt/venv/bin/python -m ensurepip --upgrade 2>/dev/null || true"]\n' >> "${buildAppDirectory}/nixpacks.toml" ;
      fi
      if [ -z "$NIXPACKS_INSTALL_CMD" ]; then
        if [ -f "${buildAppDirectory}/uv.lock" ]; then
          export NIXPACKS_INSTALL_CMD="uv sync" ;
        elif [ -f "${buildAppDirectory}/poetry.lock" ]; then
          export NIXPACKS_INSTALL_CMD="poetry install --no-interaction" ;
        elif [ -f "${buildAppDirectory}/Pipfile" ]; then
          export NIXPACKS_INSTALL_CMD="pipenv install --deploy" ;
        elif [ -f "${buildAppDirectory}/requirements.txt" ]; then
          export NIXPACKS_INSTALL_CMD="test -f /opt/venv/bin/pip && /opt/venv/bin/pip install -r requirements.txt || python3 -m pip install -r requirements.txt || pip install -r requirements.txt" ;
        fi
      fi
      if [ -z "$NIXPACKS_START_CMD" ]; then
        if [ -f "${buildAppDirectory}/streamlit_app.py" ]; then
          export NIXPACKS_START_CMD="streamlit run streamlit_app.py --server.port=8501 --server.address=0.0.0.0" ;
        elif [ -f "${buildAppDirectory}/app.py" ] && grep -qi "streamlit" "${buildAppDirectory}/requirements.txt" 2>/dev/null; then
          export NIXPACKS_START_CMD="streamlit run app.py --server.port=8501 --server.address=0.0.0.0" ;
        elif [ -f "${buildAppDirectory}/app.py" ] && grep -qi "streamlit" "${buildAppDirectory}/app.py" 2>/dev/null; then
          export NIXPACKS_START_CMD="streamlit run app.py --server.port=8501 --server.address=0.0.0.0" ;
        elif [ -f "${buildAppDirectory}/manage.py" ]; then
          export NIXPACKS_START_CMD="python manage.py runserver 0.0.0.0:8000" ;
        elif [ -f "${buildAppDirectory}/main.py" ]; then
          export NIXPACKS_START_CMD="python main.py" ;
        elif [ -f "${buildAppDirectory}/app.py" ]; then
          export NIXPACKS_START_CMD="python app.py" ;
        fi
      fi
    fi
  fi

  # Consistency check: Never let JS package manager run on pure Python project
  if [ "$NIXPACKS_PROVIDER" = "python" ]; then
    if echo "$NIXPACKS_INSTALL_CMD" | grep -qi "npm"; then
      echo "⚠️ Warning: Inconsistent install command detected ('$NIXPACKS_INSTALL_CMD' on Python project). Correcting to pip." ;
      export NIXPACKS_INSTALL_CMD="test -f /opt/venv/bin/pip && /opt/venv/bin/pip install -r requirements.txt || python3 -m pip install -r requirements.txt || pip install -r requirements.txt" ;
    fi
  fi

  # Detect whether this is a static SPA without a backend server
  IS_STATIC_SPA=$(node -e "
    try {
      const p = require('${buildAppDirectory}/package.json');
      const d = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
      const s = p.scripts || {};
      const isSpa = Boolean(d.vite || d['react-scripts'] || d['@vue/cli-service'] || (d.svelte && !d['@sveltejs/kit']));
      const rawStart = s.start ? String(s.start).trim() : '';
      const isDevStart = rawStart === 'vite' || /^vite(?:\s+(?:dev|serve))?\b/i.test(rawStart);
      const isPreview = s.preview || /\bpreview\b/i.test(rawStart);
      const hasBackendServer = s['start:prod'] || s.serve || s.server || (!isDevStart && !isPreview && rawStart) || p.main;
      console.log(Boolean(isSpa && !hasBackendServer && !isPreview));
    } catch(e) { console.log('false'); }
  " 2>/dev/null || echo 'false')

  # Enforce Node provider for JS/TS apps to prevent Caddy injection (except for static SPAs)
  if [ -f "${buildAppDirectory}/package.json" ] && [ "$IS_STATIC_SPA" != "true" ]; then
    export NIXPACKS_PROVIDER="node"
    if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
      printf 'providers = ["node"]\n' > "${buildAppDirectory}/nixpacks.toml" ;
    elif ! grep -q "providers" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
      printf '\nproviders = ["node"]\n' >> "${buildAppDirectory}/nixpacks.toml" ;
    fi
  fi

  REQUESTED_NODE=""
  if [ -f "${buildAppDirectory}/.nvmrc" ]; then
    REQUESTED_NODE=$(cat "${buildAppDirectory}/.nvmrc" | tr -d 'v\\r\\n ' | cut -d. -f1)
  elif [ -f "${buildAppDirectory}/.node-version" ]; then
    REQUESTED_NODE=$(cat "${buildAppDirectory}/.node-version" | tr -d 'v\\r\\n ' | cut -d. -f1)
  elif [ -f "${buildAppDirectory}/runtime.txt" ]; then
    REQUESTED_NODE=$(cat "${buildAppDirectory}/runtime.txt" | sed -E 's/^node(js)?[-_]?//I' | tr -d 'v\\r\\n ' | cut -d. -f1)
  elif [ -f "${buildAppDirectory}/package.json" ]; then
    REQUESTED_NODE=$(node -e "try { const p = require('${buildAppDirectory}/package.json'); const n = (p.engines && p.engines.node) ? p.engines.node.replace(/^[v^~>=<\\\\s]+/, '').split('.')[0] : ''; console.log(n); } catch(e){}" 2>/dev/null || true)
  fi

  # Check policy for End-Of-Life runtimes
  ALLOW_LEGACY="\${ALLOW_LEGACY_RUNTIMES:-\${HATDOT_ALLOW_EOL_RUNTIMES:-true}}"

  # Detect modern dependency engine constraints (Vite 8, Rolldown, jsdom 29)
  REQUIRES_NODE22_MODERN=$(node -e "
    try {
      const p = require('${buildAppDirectory}/package.json');
      const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
      const eng = String((p.engines && p.engines.node) || '');
      const hasVite8 = deps.vite && /^[\^~]?[89]/.test(deps.vite);
      const hasRoll = Boolean(deps.rolldown);
      const hasViteReact5 = deps['@vitejs/plugin-react'] && /^[\^~]?[5-9]/.test(deps['@vitejs/plugin-react']);
      const hasJsdom29 = deps.jsdom && /^[\^~]?(?:29|3[0-9])/.test(deps.jsdom);
      const engModern = /22\.1[2-9]|22\.[2-9]|\^22\.1[3-9]|>=22\.1[2-9]/.test(eng);
      console.log(Boolean(hasVite8 || hasRoll || hasViteReact5 || hasJsdom29 || engModern));
    } catch(e) { console.log('false'); }
  " 2>/dev/null || echo 'false')

  if [ "$REQUIRES_NODE22_MODERN" = "true" ] && ([ "$REQUESTED_NODE" = "18" ] || [ "$REQUESTED_NODE" = "16" ] || [ "$REQUESTED_NODE" = "14" ]); then
    echo "❌ Dependency Engine Conflict: Modern project dependencies (Vite 8 / Rolldown) require Node.js ^20.19.0 || >=22.12.0, which conflicts with requested Node.js $REQUESTED_NODE." ;
    echo "💡 Remediation: Upgrade your project to Node.js 20 or 22 in package.json engines or .nvmrc." ;
    exit 1;
  fi

  if [ "$REQUESTED_NODE" = "24" ]; then
    echo "✓ HatDot applying verified package source (Node.js 24.11.0: ${archive2411}) for Node 24 compatibility." ;
    export NIXPACKS_NODE_VERSION="24.11.0" ;
    export NIXPACKS_PKGS_ARCHIVE="${archive2411}" ;
    export NIXPACKS_NIXPKGS_ARCHIVE="${archive2411}" ;
    if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
      printf '# Generated by HatDot for Node.js 24 compatibility\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2411}" > "${buildAppDirectory}/nixpacks.toml" ;
    elif ! grep -q "nixpkgsArchive" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
      printf '\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2411}" >> "${buildAppDirectory}/nixpacks.toml" ;
    fi
  elif [ "$REQUIRES_NODE22_MODERN" = "true" ] && ([ "$REQUESTED_NODE" = "22" ] || [ -z "$REQUESTED_NODE" ]); then
    echo "✓ HatDot detected modern engine requirements (Vite 8 / Rolldown). Pinning compatible Node.js 22.13.1 runtime (${archive2213})." ;
    export NIXPACKS_NODE_VERSION="22.13.1" ;
    export NIXPACKS_PKGS_ARCHIVE="${archive2213}" ;
    export NIXPACKS_NIXPKGS_ARCHIVE="${archive2213}" ;
    if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
      printf '# Generated by HatDot for Node.js 22.13.1 compatibility\nproviders = ["node"]\n\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2213}" > "${buildAppDirectory}/nixpacks.toml" ;
    elif ! grep -q "nixpkgsArchive" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
      printf '\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2213}" >> "${buildAppDirectory}/nixpacks.toml" ;
    fi
  fi

  if [ "$REQUESTED_NODE" = "18" ]; then
    if [ "$ALLOW_LEGACY" = "false" ]; then
      echo "❌ Deployment Rejected by Policy: Node.js 18 reached End-Of-Life on 2025-04-30 and organizational policy forbids unmaintained runtimes." ;
      echo "💡 Remediation: Upgrade your project to Node.js 20 or 22 in package.json / .nvmrc, or contact your administrator." ;
      exit 1;
    fi
    echo "⚠️ Notice: Project specifies Node.js 18.x which reached End-Of-Life upstream on 2025-04-30." ;
    echo "✓ HatDot applying verified pinned package source (NixOS 24.05 LTS: ${archive2405}) for Node.js 18.x compatibility." ;
    export NIXPACKS_NODE_VERSION=18 ;
    export NIXPACKS_PKGS_ARCHIVE="${archive2405}" ;
    export NIXPACKS_NIXPKGS_ARCHIVE="${archive2405}" ;

    # Write / configure nixpacks.toml with pinned archive if not already present
    if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
      printf '# Generated by HatDot for Node.js 18 compatibility\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2405}" > "${buildAppDirectory}/nixpacks.toml" ;
    elif ! grep -q "nixpkgsArchive" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
      printf '\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2405}" >> "${buildAppDirectory}/nixpacks.toml" ;
    fi
  elif [ "$REQUESTED_NODE" = "16" ]; then
    if [ "$ALLOW_LEGACY" = "false" ]; then
      echo "❌ Deployment Rejected by Policy: Node.js 16 reached End-Of-Life on 2023-09-11 and organizational policy forbids unmaintained runtimes." ;
      echo "💡 Remediation: Upgrade your project to Node.js 20 or 22 in package.json / .nvmrc." ;
      exit 1;
    fi
    echo "⚠️ Notice: Project specifies Node.js 16.x which reached End-Of-Life upstream." ;
    echo "✓ HatDot applying verified pinned package source (NixOS 23.11 LTS: ${archive2311}) for Node.js 16.x compatibility." ;
    export NIXPACKS_NODE_VERSION=16 ;
    export NIXPACKS_PKGS_ARCHIVE="${archive2311}" ;
    export NIXPACKS_NIXPKGS_ARCHIVE="${archive2311}" ;
    if [ ! -f "${buildAppDirectory}/nixpacks.toml" ]; then
      printf '# Generated by HatDot for Node.js 16 compatibility\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2311}" > "${buildAppDirectory}/nixpacks.toml" ;
    elif ! grep -q "nixpkgsArchive" "${buildAppDirectory}/nixpacks.toml" 2>/dev/null; then
      printf '\n[phases.setup]\nnixpkgsArchive = "%s"\n' "${archive2311}" >> "${buildAppDirectory}/nixpacks.toml" ;
    fi
  elif [ "$REQUESTED_NODE" = "14" ] || [ "$REQUESTED_NODE" = "12" ] || [ "$REQUESTED_NODE" = "10" ]; then
    echo "❌ Deployment Error: Node.js $REQUESTED_NODE reached End-Of-Life and cannot be safely obtained from verified package sources." ;
    echo "💡 Remediation: Upgrade your project to Node.js 18, 20, or 22 in package.json / .nvmrc, or deploy using a custom Dockerfile." ;
    exit 1;
  fi

  # Align lockfiles and prevent conflicting package manager executions (e.g. npm ci with bun)
  if [ -z "$NIXPACKS_INSTALL_CMD" ]; then
    HAS_BUILD_SCRIPT=""
    if [ -f "${buildAppDirectory}/package.json" ]; then
      HAS_BUILD_SCRIPT=$(node -e "try { const p = require('${buildAppDirectory}/package.json'); console.log(Boolean(p.scripts && p.scripts.build)); } catch(e){}" 2>/dev/null || true)
    fi

    if [ -f "${buildAppDirectory}/bun.lockb" ] || [ -f "${buildAppDirectory}/bun.lock" ]; then
      echo "✓ Detected Bun package manager. Applying frozen install." ;
      export NIXPACKS_INSTALL_CMD="bun install --frozen-lockfile" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="bun run build" ;
      fi
    elif [ -f "${buildAppDirectory}/pnpm-lock.yaml" ]; then
      export NIXPACKS_INSTALL_CMD="pnpm install --frozen-lockfile" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="pnpm run build" ;
      fi
    elif [ -f "${buildAppDirectory}/yarn.lock" ]; then
      export NIXPACKS_INSTALL_CMD="yarn install --frozen-lockfile" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="yarn build" ;
      fi
    elif [ -f "${buildAppDirectory}/package-lock.json" ]; then
      export NIXPACKS_INSTALL_CMD="npm ci --include=dev --include=optional" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="npm run build" ;
      fi
    elif [ -f "${buildAppDirectory}/package.json" ]; then
      export NIXPACKS_INSTALL_CMD="npm i --include=dev --include=optional" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="npm run build" ;
      fi
    fi
  fi

  # Fix cross-platform lockfile optional dependency omissions (npm/cli#4828)
  if [ -f "${buildAppDirectory}/package.json" ]; then
    NATIVE_REPAIR='if [ -d "node_modules/rolldown" ]; then ARCH=$(uname -m); case "$ARCH" in x86_64) PKG="@rolldown/binding-linux-x64-gnu" ;; aarch64|arm64) PKG="@rolldown/binding-linux-arm64-gnu" ;; *) PKG="" ;; esac; if [ -n "$PKG" ] && [ ! -d "node_modules/$PKG" ]; then VER=$(node -e "try { console.log(require(\"./node_modules/rolldown/package.json\").version); } catch(e){}" 2>/dev/null || true); echo "⚡ HatDot detected missing Rolldown Linux native binding ($PKG@\${VER}). Installing..."; if [ -n "$VER" ]; then npm i "$PKG@$VER" --no-save; else npm i "$PKG" --no-save; fi || { echo "❌ Failed to install required Rolldown native binding: $PKG"; exit 1; }; fi; fi'
    if [ -n "$NIXPACKS_BUILD_CMD" ]; then
      case "$NIXPACKS_BUILD_CMD" in
        *"@rolldown/binding"*|"rolldown"*) ;;
        *) export NIXPACKS_BUILD_CMD="\${NATIVE_REPAIR}; \${NIXPACKS_BUILD_CMD}" ;;
      esac
    elif [ "$HAS_BUILD_SCRIPT" = "true" ]; then
      export NIXPACKS_BUILD_CMD="\${NATIVE_REPAIR}; npm run build" ;
    fi
  fi

  # Resolve dynamic startup command if not explicitly supplied
  if [ -z "$NIXPACKS_START_CMD" ] && [ -f "${buildAppDirectory}/package.json" ]; then
    if [ "$IS_STATIC_SPA" = "true" ]; then
      echo "✓ Detected static frontend SPA. Allowing Nixpacks Caddy static server to host production build on port 80." ;
    else
      DETECTED_START=$(node -e "
        try {
          const p = require('${buildAppDirectory}/package.json');
          const s = p.scripts || {};
          const start = s.start || '';
          const isViteDev = /vite(\s|$)/.test(start) && !start.includes('preview');
          if (s.start && !isViteDev) {
            console.log('npm start');
          } else if (s['start:prod']) {
            console.log('npm run start:prod');
          } else if (s.serve) {
            console.log('npm run serve');
          } else if (s.server) {
            console.log('npm run server');
          } else if (s.prod) {
            console.log('npm run prod');
          } else if (s.preview) {
            console.log('npm run preview -- --host 0.0.0.0 --port 4173');
          } else if (p.main) {
            console.log('node ' + p.main);
          }
        } catch(e) {}
      " 2>/dev/null || true)

      if [ -n "$DETECTED_START" ]; then
        export NIXPACKS_START_CMD="$DETECTED_START"
        echo "✓ HatDot resolved application startup command: $DETECTED_START" ;
      elif [ -f "${buildAppDirectory}/server.js" ]; then
        export NIXPACKS_START_CMD="node server.js"
        echo "✓ HatDot detected entrypoint: node server.js" ;
      elif [ -f "${buildAppDirectory}/app.js" ]; then
        export NIXPACKS_START_CMD="node app.js"
        echo "✓ HatDot detected entrypoint: node app.js" ;
      elif [ -f "${buildAppDirectory}/index.js" ]; then
        export NIXPACKS_START_CMD="node index.js"
        echo "✓ HatDot detected entrypoint: node index.js" ;
      fi
    fi
  fi
fi
`;

	// Portable POSIX shell status capture replacing Bash-specific PIPESTATUS[0] to prevent Bad substitution
	let bashCommand = `
echo "Starting Nixpacks build..." ;
${preflightShell}

TMP_LOG=$(mktemp 2>/dev/null || echo "/tmp/nixpacks-$$.log")
TMP_STATUS=$(mktemp 2>/dev/null || echo "/tmp/nixpacks-status-$$.log")

(${command}; echo "$?" > "$TMP_STATUS") 2>&1 | tee "$TMP_LOG"
NIX_STATUS=$(cat "$TMP_STATUS" 2>/dev/null)
rm -f "$TMP_STATUS" 2>/dev/null || true
case "$NIX_STATUS" in
  ""|*[!0-9]*) NIX_STATUS=1 ;;
esac

if [ "$NIX_STATUS" != "0" ]; then
  if grep -qi "has reached End-Of-Life and has been removed" "$TMP_LOG" 2>/dev/null; then
    echo "❌ Deployment Error: The requested runtime has reached End-Of-Life and was removed from the package repository." ;
    echo "💡 Remediation: Specify a compatible package archive or upgrade to a modern supported runtime in settings." ;
  elif grep -qi "no start command could be found" "$TMP_LOG" 2>/dev/null; then
    if [ "$NIXPACKS_PROVIDER" = "python" ] || [ -f "${buildAppDirectory}/requirements.txt" ] || [ -f "${buildAppDirectory}/app.py" ]; then
      echo "❌ Start Command Error: No start command could be found for this Python application." ;
      echo "💡 Remediation: Ensure your application provides a recognized entry point (app.py, main.py) or configure a Custom Start Command in Application Settings (e.g. 'streamlit run app.py --server.port=8501 --server.address=0.0.0.0')." ;
    else
      echo "❌ Start Command Error: No start command could be found for this application." ;
      echo "💡 Remediation: Add a 'start' script to your package.json (e.g. 'node server.js' or 'next start'), configure a Custom Start Command in Application Settings, or configure a Publish Directory if deploying a static web app." ;
    fi
  else
    echo "❌ Nixpacks build failed with exit code $NIX_STATUS" ;
  fi
  rm -f "$TMP_LOG" 2>/dev/null || true
  exit 1;
fi
rm -f "$TMP_LOG" 2>/dev/null || true
echo "✅ Nixpacks build completed." ;
`;

	/*
		Run the container with the image created by nixpacks,
		and copy the artifacts on the host filesystem.
		Then, remove the container and create a static build.
	 */
	if (publishDirectory) {
		const localPath = path.join(buildAppDirectory, publishDirectory);
		const isDirectory =
			publishDirectory.endsWith("/") || !path.extname(publishDirectory);

		bashCommand += `
	docker create --name ${buildContainerId} ${appName}
	mkdir -p ${quote([localPath])}
	docker cp ${quote([`${buildContainerId}:/app/${publishDirectory}${isDirectory ? "/." : ""}`])} ${quote([localPath])} || {
		docker rm ${buildContainerId}
		echo ${quote([`❌ Copying ${publishDirectory} to ${localPath} failed`])} ;
		exit 1;
	}
	docker rm ${buildContainerId}
	${getStaticCommand(application)}
				`;
	}

	return bashCommand;
};
