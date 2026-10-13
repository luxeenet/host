import fs from "node:fs";
import path from "node:path";
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
	const { env, appName, publishDirectory, cleanCache } = application;

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

	// Always ensure NIXPACKS_PATH is initialized to avoid BuildKit UndefinedVar warnings
	const hasNixpacksPath = envVariables.some((e) =>
		e.startsWith("NIXPACKS_PATH="),
	);
	if (!hasNixpacksPath) {
		args.push("--env", "NIXPACKS_PATH=");
	}

	// Static host inspection if the directory already exists on host
	let preResolvedNodeEnv: string | undefined;
	let preResolvedInstallCmd: string | undefined;
	let preResolvedBuildCmd: string | undefined;
	let preResolvedArchive: string | undefined;

	if (fs.existsSync(buildAppDirectory)) {
		try {
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

			// Write or augment nixpacks.toml if pinned archive is required
			if (runtime.nixpkgsArchive) {
				const nixpacksTomlPath = path.join(buildAppDirectory, "nixpacks.toml");
				if (!fs.existsSync(nixpacksTomlPath)) {
					fs.writeFileSync(
						nixpacksTomlPath,
						generateNixpacksToml({
							nixpkgsArchive: runtime.nixpkgsArchive,
						}),
						"utf-8",
					);
				}
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
	const hasCustomerArchive = envVariables.some(
		(e) =>
			e.startsWith("NIXPACKS_PKGS_ARCHIVE=") ||
			e.startsWith("NIXPACKS_NIXPKGS_ARCHIVE="),
	);

	if (preResolvedNodeEnv && !hasCustomerNodeVersion) {
		args.push("--env", `NIXPACKS_NODE_VERSION=${preResolvedNodeEnv}`);
	}

	if (preResolvedArchive && !hasCustomerArchive) {
		args.push("--env", `NIXPACKS_PKGS_ARCHIVE=${preResolvedArchive}`);
		args.push("--env", `NIXPACKS_NIXPKGS_ARCHIVE=${preResolvedArchive}`);
	}

	if (preResolvedInstallCmd && !hasCustomerInstallCmd) {
		args.push(
			"--env",
			`NIXPACKS_INSTALL_CMD=${quote([preResolvedInstallCmd])}`,
		);
	}

	if (preResolvedBuildCmd && !hasCustomerBuildCmd) {
		args.push("--env", `NIXPACKS_BUILD_CMD=${quote([preResolvedBuildCmd])}`);
	}

	if (publishDirectory) {
		/* No need for any start command, since we'll use nginx later on */
		args.push("--no-error-without-start");
	}

	const command = `nixpacks ${args.join(" ")}`;

	// Pinned Nixpkgs archive hashes
	const archive2405 = NIXPKGS_ARCHIVES.LEGACY_24_05.commit;
	const archive2311 = NIXPKGS_ARCHIVES.LEGACY_23_11.commit;

	// Shell preflight ensures runtime compatibility even if repository was cloned inside the deploy bash script
	const preflightShell = `
# HatDot Runtime Compatibility & Nixpacks Preflight
# Safe environment variable initialization
export NIXPACKS_PATH="\${NIXPACKS_PATH:-}"

if [ -d ${quote([buildAppDirectory])} ]; then
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
      export NIXPACKS_INSTALL_CMD="npm ci" ;
      if [ "$HAS_BUILD_SCRIPT" = "true" ] && [ -z "$NIXPACKS_BUILD_CMD" ]; then
        export NIXPACKS_BUILD_CMD="npm run build" ;
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
NIX_STATUS=$(cat "$TMP_STATUS" 2>/dev/null || echo 1)
rm -f "$TMP_STATUS" 2>/dev/null || true

if [ "$NIX_STATUS" -ne 0 ]; then
  if grep -qi "has reached End-Of-Life and has been removed" "$TMP_LOG" 2>/dev/null; then
    echo "❌ Deployment Error: The requested runtime has reached End-Of-Life and was removed from the package repository." ;
    echo "💡 Remediation: Specify a compatible package archive or upgrade to a modern supported runtime in settings." ;
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
