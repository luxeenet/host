import fs from "node:fs";
import path from "node:path";
import { getStaticCommand } from "@dokploy/server/utils/builders/static";
import { nanoid } from "nanoid";
import { quote } from "shell-quote";
import { prepareEnvironmentVariablesForShell } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";
import {
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

	// Static inspection if the directory already exists on host
	let preResolvedNodeEnv: string | undefined;
	let preResolvedInstallCmd: string | undefined;
	let preResolvedBuildCmd: string | undefined;

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

			if (runtime.isEol) {
				preResolvedNodeEnv = runtime.resolvedVersion;
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

	if (preResolvedNodeEnv && !hasCustomerNodeVersion) {
		args.push("--env", `NIXPACKS_NODE_VERSION=${preResolvedNodeEnv}`);
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

	// Shell preflight ensures runtime compatibility even if repository was cloned inside the deploy bash script
	const preflightShell = `
# HatDot Runtime Compatibility & Nixpacks Preflight
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

  if [ "$REQUESTED_NODE" = "18" ] || [ "$REQUESTED_NODE" = "16" ] || [ "$REQUESTED_NODE" = "14" ] || [ "$REQUESTED_NODE" = "12" ]; then
    echo "⚠️ Notice: Project specifies Node.js $REQUESTED_NODE which reached End-Of-Life and has been removed from Nixpkgs." ;
    echo "✓ HatDot automatically configuring Nixpacks to use supported LTS: Node.js 20." ;
    export NIXPACKS_NODE_VERSION=20 ;
  fi

  # Align lockfiles and prevent conflicting package manager executions (e.g. npm ci with bun)
  if [ -z "$NIXPACKS_INSTALL_CMD" ]; then
    HAS_BUILD_SCRIPT=""
    if [ -f "${buildAppDirectory}/package.json" ]; then
      HAS_BUILD_SCRIPT=$(node -e "try { const p = require('${buildAppDirectory}/package.json'); console.log(Boolean(p.scripts && p.scripts.build)); } catch(e){}" 2>/dev/null || true)
    fi

    if [ -f "${buildAppDirectory}/bun.lockb" ] || [ -f "${buildAppDirectory}/bun.lock" ]; then
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

	let bashCommand = `
echo "Starting Nixpacks build..." ;
${preflightShell}

TMP_LOG=$(mktemp 2>/dev/null || echo "/tmp/nixpacks-$$.log")
(${command}) 2>&1 | tee "$TMP_LOG"
NIX_STATUS=\${PIPESTATUS[0]}

if [ $NIX_STATUS -ne 0 ]; then
  if grep -qi "has reached End-Of-Life and has been removed" "$TMP_LOG" 2>/dev/null; then
    echo "❌ Deployment Error: The requested runtime has reached End-Of-Life and was removed from the package repository." ;
    echo "💡 Remediation: Upgrade your project to Node.js 20 or 22 in package.json / .nvmrc, or select Dockerfile builder in settings." ;
  else
    echo "❌ Nixpacks build failed" ;
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
