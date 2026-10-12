import path from "node:path";
import {
	getEnvironmentVariablesObject,
	prepareEnvironmentVariablesForShell,
} from "@dokploy/server/utils/docker/utils";
import { quote } from "shell-quote";
import {
	getBuildAppDirectory,
	getDockerContextPath,
} from "../filesystem/directory";
import type { ApplicationNested } from ".";
import { createEnvFileCommand } from "./utils";

export const getDockerCommand = (application: ApplicationNested) => {
	const {
		appName,
		env,
		publishDirectory,
		buildArgs,
		buildSecrets,
		dockerBuildStage,
		cleanCache,
		createEnvFile,
	} = application;
	const dockerFilePath = getBuildAppDirectory(application);

	try {
		const image = `${appName}`;

		const defaultContextPath = path.dirname(dockerFilePath) || ".";
		const dockerContextPath =
			getDockerContextPath(application) || defaultContextPath;

		const commandArgs = [
			"build",
			"-t",
			image,
			"-f",
			dockerFilePath,
			dockerContextPath,
		];

		if (dockerBuildStage) {
			commandArgs.push("--target", dockerBuildStage);
		}

		if (cleanCache) {
			commandArgs.push("--no-cache");
		}

		const args = prepareEnvironmentVariablesForShell(
			buildArgs,
			application.environment.project.env,
			application.environment.env,
		);

		for (const arg of args) {
			commandArgs.push("--build-arg", arg);
		}

		const secrets = getEnvironmentVariablesObject(
			buildSecrets,
			application.environment.project.env,
			application.environment.env,
		);

		const joinedSecrets = Object.entries(secrets)
			.map(([key, value]) => `${key}=${quote([value])}`)
			.join(" ");

		/*
			Do not generate an environment file when publishDirectory is specified,
			as it could be publicly exposed.
			Also respect the createEnvFile flag.
		*/
		let command = "";
		if (!publishDirectory && createEnvFile) {
			command += createEnvFileCommand(
				dockerFilePath,
				env,
				application.environment.project.env,
				application.environment.env,
			);
		}

		for (const key in secrets) {
			// Ensure secret type is env
			commandArgs.push("--secret", `type=env,id=${key}`);
		}

		command += `
echo ${quote([`Building ${appName} using Dockerfile`])} ;
if [ ! -f ${quote([dockerFilePath])} ]; then
  echo ${quote([`❌ Dockerfile not found at: ${dockerFilePath}`])} ;
  echo "Please verify the Dockerfile path in your application settings." ;
  exit 1;
fi

cd ${quote([dockerContextPath])} || {
  echo ${quote([`❌ Docker context path ${dockerContextPath} does not exist`])} ;
  exit 1;
}

${joinedSecrets} docker ${commandArgs.join(" ")} || {
  echo "❌ Docker build failed. Inspect the Docker engine logs above for details." ;
  exit 1;
}
echo "✅ Docker build completed." ;
		`;

		return command;
	} catch (error) {
		throw error;
	}
};
