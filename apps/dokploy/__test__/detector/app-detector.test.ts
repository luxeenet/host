import { describe, expect, it } from "vitest";
import {
	detectFrameworkFromFiles,
	type FileEntry,
} from "@dokploy/server/services/app-detector";

describe("Deterministic Application Framework & Port Detector", () => {
	it("should detect Next.js application with TypeScript and pnpm", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "my-next-app",
					dependencies: {
						next: "^14.2.0",
						react: "^18.3.0",
					},
					devDependencies: {
						typescript: "^5.0.0",
					},
					scripts: {
						build: "next build",
						start: "next start",
					},
				}),
			},
			{
				name: "pnpm-lock.yaml",
				path: "pnpm-lock.yaml",
				content: "lockfileVersion: '9.0'",
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Next.js");
		expect(result.language).toBe("TypeScript");
		expect(result.suggestedPort).toBe(3000);
		expect(result.buildType).toBe("nixpacks");
		expect(result.packageManager).toBe("pnpm");
		expect(result.buildCommand).toBe("pnpm build");
		expect(result.startCommand).toBe("pnpm start");
		expect(result.confidence).toBe("high");
	});

	it("should detect Vite React SPA application", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "my-vite-app",
					dependencies: {
						react: "^18.3.0",
						"react-dom": "^18.3.0",
					},
					devDependencies: {
						vite: "^5.2.0",
					},
					scripts: {
						build: "vite build",
						preview: "vite preview",
					},
				}),
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Vite (React)");
		expect(result.suggestedPort).toBe(4173);
		expect(result.buildType).toBe("nixpacks");
		expect(result.confidence).toBe("high");
	});

	it("should detect Express Node.js application", () => {
		const files: FileEntry[] = [
			{
				name: "package.json",
				path: "package.json",
				content: JSON.stringify({
					name: "api-server",
					main: "dist/index.js",
					dependencies: {
						express: "^4.19.0",
					},
					scripts: {
						build: "tsc",
						start: "node dist/index.js",
					},
				}),
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Node.js (Express)");
		expect(result.suggestedPort).toBe(3000);
		expect(result.buildType).toBe("nixpacks");
		expect(result.startCommand).toBe("npm start");
	});

	it("should detect Dockerfile with EXPOSE directive", () => {
		const files: FileEntry[] = [
			{
				name: "Dockerfile",
				path: "Dockerfile",
				content: `
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o server .
FROM alpine:latest
EXPOSE 8080
CMD ["/app/server"]
`,
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Dockerfile");
		expect(result.buildType).toBe("dockerfile");
		expect(result.suggestedPort).toBe(8080);
		expect(result.confidence).toBe("high");
	});

	it("should detect Docker Compose stack", () => {
		const files: FileEntry[] = [
			{
				name: "docker-compose.yml",
				path: "docker-compose.yml",
				content: `
version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
`,
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Docker Compose");
		expect(result.buildType).toBe("compose");
		expect(result.suggestedPort).toBe(80);
	});

	it("should detect Python FastAPI application", () => {
		const files: FileEntry[] = [
			{
				name: "requirements.txt",
				path: "requirements.txt",
				content: "fastapi==0.110.0\nuvicorn==0.28.0\npydantic==2.6.4\n",
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("FastAPI");
		expect(result.language).toBe("Python");
		expect(result.suggestedPort).toBe(8000);
		expect(result.buildType).toBe("nixpacks");
		expect(result.startCommand).toContain("uvicorn");
	});

	it("should detect Go application from go.mod", () => {
		const files: FileEntry[] = [
			{
				name: "go.mod",
				path: "go.mod",
				content: "module github.com/user/myproject\n\ngo 1.22\n",
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Go Application");
		expect(result.language).toBe("Go");
		expect(result.suggestedPort).toBe(8080);
		expect(result.buildType).toBe("nixpacks");
	});

	it("should detect Static HTML site", () => {
		const files: FileEntry[] = [
			{
				name: "index.html",
				path: "index.html",
				content: "<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>",
			},
		];

		const result = detectFrameworkFromFiles(files);
		expect(result.framework).toBe("Static HTML");
		expect(result.buildType).toBe("static");
		expect(result.suggestedPort).toBe(80);
	});
});
