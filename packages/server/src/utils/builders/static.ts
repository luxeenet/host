import { getDockerCommand } from "@dokploy/server/utils/builders/docker-file";
import { getCreateFileCommand } from "../docker/utils";
import { getBuildAppDirectory } from "../filesystem/directory";
import type { ApplicationNested } from ".";

export const generateNginxConfig = (isSpa: boolean): string => `
worker_processes auto;

events {
  worker_connections 1024;
}

http {
  include       mime.types;
  default_type  application/octet-stream;

  sendfile        on;
  keepalive_timeout  65;

  # Gzip compression
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_comp_level 6;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;

  access_log /dev/stdout;
  error_log /dev/stderr;

  server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html index.htm;

    # Custom 404 page if present
    error_page 404 /404.html;
    location = /404.html {
      internal;
    }

    # Static assets: immutable cache, strict 404 (never rewrite assets to index.html)
    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|svg|woff|woff2|ttf|eot|webp|avif|wasm|json)$ {
      expires 1y;
      add_header Cache-Control "public, max-age=31536000, immutable";
      try_files $uri =404;
    }

    # API routes should never be rewritten to index.html
    location /api/ {
      try_files $uri =404;
    }

    # HTML / SPA fallback configuration
    location / {
      add_header Cache-Control "no-cache";
      ${
				isSpa
					? "try_files $uri $uri/ /index.html;"
					: "try_files $uri $uri/ =404;"
			}
    }
  }
}
`;

export const generateStaticDockerfile = (publishDirectory = "."): string =>
	[
		"FROM nginx:alpine",
		"WORKDIR /usr/share/nginx/html/",
		"COPY nginx.conf /etc/nginx/nginx.conf",
		`COPY ${publishDirectory} .`,
		'CMD ["nginx", "-g", "daemon off;"]',
	].join("\n");

export const getStaticCommand = (application: ApplicationNested) => {
	const { publishDirectory, isStaticSpa } = application;
	const buildAppDirectory = getBuildAppDirectory(application);
	const nginxConfig = generateNginxConfig(Boolean(isStaticSpa));
	const pubDir = publishDirectory?.trim() ? publishDirectory.trim() : ".";

	let command = "";
	// Always write optimized nginx configuration
	command += getCreateFileCommand(buildAppDirectory, "nginx.conf", nginxConfig);

	command += getCreateFileCommand(
		buildAppDirectory,
		".dockerignore",
		[".git", ".env", "Dockerfile", ".dockerignore"].join("\n"),
	);

	// Validate document root and entry point before build
	const validateScript = `
echo "Validating static document root..." ;
if [ ! -d "${buildAppDirectory}/${pubDir}" ] && [ "${pubDir}" != "." ]; then
  echo "⚠️ Warning: Publish directory '${pubDir}' not found in ${buildAppDirectory}, falling back to project root" ;
fi
`;

	command += validateScript;

	command += getCreateFileCommand(
		buildAppDirectory,
		"Dockerfile",
		generateStaticDockerfile(pubDir),
	);

	command += getDockerCommand({
		...application,
		buildType: "dockerfile",
		dockerfile: "Dockerfile",
	});

	return command;
};
