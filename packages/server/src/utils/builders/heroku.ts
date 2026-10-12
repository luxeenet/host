import { prepareEnvironmentVariablesForShell } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";

export const getHerokuCommand = (application: ApplicationNested) => {
	const { env, appName, cleanCache } = application;

	const buildAppDirectory = getBuildAppDirectory(application);
	const envVariables = prepareEnvironmentVariablesForShell(
		env,
		application.environment.project.env,
		application.environment.env,
	);

	const builderImage = `heroku/builder:${application.herokuVersion || "24"}`;

	const args = [
		"build",
		appName,
		"--path",
		buildAppDirectory,
		"--builder",
		builderImage,
	];

	if (cleanCache) {
		args.push("--clear-cache");
	}

	for (const env of envVariables) {
		args.push("--env", env);
	}

	const command = `pack ${args.join(" ")}`;
	const bashCommand = `
echo "Starting Heroku Cloud Native Buildpack deployment for ${appName}..." ;
if ! command -v pack >/dev/null 2>&1; then
  echo "❌ Buildpack CLI 'pack' is not installed or available on this host." ;
  echo "💡 Please ensure Cloud Native Buildpacks (pack) is installed or select Nixpacks or Dockerfile in settings." ;
  exit 1;
fi

${command} || { 
  echo "❌ Heroku Buildpack build failed." ;
  echo "💡 Tip: Verify that your repository contains a supported language/framework, Procfile, or valid project configuration for builder: ${builderImage}." ;
  exit 1;
}
echo "✅ Heroku build completed." ;
`;

	return bashCommand;
};
