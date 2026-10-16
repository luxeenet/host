import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import tls from "node:tls";
import {
	detectHostRejection,
	type HostRejection,
} from "../builders/host-validation";
import type { DiagnosticCode } from "./diagnostics";

export interface HttpResponseClassification {
	isHealthy: boolean;
	isHostRejected: boolean;
	isUpstreamUnreachable: boolean;
	hostRejection?: HostRejection;
	diagnosticCode?: DiagnosticCode;
	message: string;
	details?: string;
}

/**
 * Classifies an HTTP response status code and body to distinguish genuine application health
 * from reverse-proxy errors (502/504), framework host rejections, and expected auth barriers.
 */
export const classifyHttpResponse = (
	status: number,
	body?: string | null,
	customAcceptedStatuses: number[] = [200, 201, 204, 301, 302, 307, 308, 401, 403, 404],
): HttpResponseClassification => {
	const bodyText = body || "";

	// 1. Framework Host-Header Rejection (e.g. Vite 403, Django 400 DisallowedHost, Rails 403 Blocked Host)
	const hostRejection = detectHostRejection({ status, body: bodyText });
	if (hostRejection) {
		return {
			isHealthy: false,
			isHostRejected: true,
			isUpstreamUnreachable: false,
			hostRejection,
			diagnosticCode: "HOST_VALIDATION_REJECTION",
			message: `${hostRejection.framework.toUpperCase()} host validation rejected the request: ${hostRejection.message}`,
			details: hostRejection.remediation,
		};
	}

	// 2. Traefik / Reverse Proxy Upstream Failures (502 Bad Gateway / 504 Gateway Timeout)
	if (status === 502 || status === 504) {
		return {
			isHealthy: false,
			isHostRejected: false,
			isUpstreamUnreachable: true,
			diagnosticCode: "PORT_MISMATCH",
			message: `Traefik returned HTTP ${status} (Bad Gateway / Upstream Unreachable).`,
			details:
				"The container is running, but Traefik cannot connect to the internal port. Verify application upstream port and interface binding (0.0.0.0).",
		};
	}

	// 3. Accepted Statuses (2xx, 3xx, 401/403 auth, 404 router/SPA)
	if (customAcceptedStatuses.includes(status)) {
		return {
			isHealthy: true,
			isHostRejected: false,
			isUpstreamUnreachable: false,
			message: `Application is responding normally with HTTP ${status}.`,
		};
	}

	// 4. Server Errors (500, 503)
	if (status >= 500) {
		return {
			isHealthy: false,
			isHostRejected: false,
			isUpstreamUnreachable: false,
			diagnosticCode: "APPLICATION_CRASH",
			message: `Application returned server error HTTP ${status}.`,
			details: "The application server started but encountered an internal error handling requests.",
		};
	}

	return {
		isHealthy: true,
		isHostRejected: false,
		isUpstreamUnreachable: false,
		message: `Application responded with HTTP ${status}.`,
	};
};

export interface TlsVerificationResult {
	isValid: boolean;
	isPending: boolean;
	error?: string;
	issuer?: string;
	validTo?: string;
	altNames?: string[];
}

/**
 * Checks actual TLS handshake and certificate validity for a given hostname.
 * Does not conflate pending Let's Encrypt issuance with application failure.
 */
export const verifyTlsCertificate = (
	host: string,
	port = 443,
	timeoutMs = 5000,
): Promise<TlsVerificationResult> => {
	return new Promise((resolve) => {
		const cleanHost = host.split(/[/:]/)[0]!.trim();
		let timedOut = false;

		const socket = tls.connect(
			{
				host: cleanHost,
				port,
				servername: cleanHost,
				rejectUnauthorized: true,
			},
			() => {
				if (timedOut) return;
				try {
					const cert = socket.getPeerCertificate(true);
					socket.end();

					const altNames = cert.subjectaltname
						? cert.subjectaltname.split(", ").map((s) => s.replace(/^DNS:/, "").trim())
						: [];

					resolve({
						isValid: true,
						isPending: false,
						issuer: cert.issuer?.O || cert.issuer?.CN,
						validTo: cert.valid_to,
						altNames,
					});
				} catch (err: any) {
					socket.destroy();
					resolve({
						isValid: false,
						isPending: false,
						error: err?.message || "Certificate inspection failed",
					});
				}
			},
		);

		socket.setTimeout(timeoutMs, () => {
			timedOut = true;
			socket.destroy();
			resolve({
				isValid: false,
				isPending: true,
				error: "TLS connection timed out (certificate issuance may be in progress)",
			});
		});

		socket.on("error", (err: any) => {
			if (timedOut) return;
			const code = err?.code || "";
			const msg = err?.message || String(err);

			const isPending =
				code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
				code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
				code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
				msg.includes("SELF_SIGNED") ||
				msg.includes("certificate");

			resolve({
				isValid: false,
				isPending,
				error: msg,
			});
		});
	});
};

/**
 * Internal probe with Host header directly to internal container upstream.
 */
export const probeInternalUpstream = (params: {
	host: string;
	port: number;
	path?: string;
	hostHeader: string;
	timeoutMs?: number;
}): Promise<{ isResponding: boolean; statusCode?: number; error?: string; body?: string }> => {
	const { host, port, path: reqPath = "/", hostHeader, timeoutMs = 4000 } = params;

	return new Promise((resolve) => {
		const req = http.request(
			{
				host,
				port,
				path: reqPath,
				method: "GET",
				headers: {
					Host: hostHeader,
					"User-Agent": "HatDot-InternalProbe/1.0",
					Accept: "*/*",
				},
				timeout: timeoutMs,
			},
			(res) => {
				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
					if (body.length > 8192) {
						req.destroy();
					}
				});
				res.on("end", () => {
					resolve({
						isResponding: true,
						statusCode: res.statusCode,
						body,
					});
				});
			},
		);

		req.on("timeout", () => {
			req.destroy();
			resolve({
				isResponding: false,
				error: `Internal probe to ${host}:${port} timed out after ${timeoutMs}ms`,
			});
		});

		req.on("error", (err: any) => {
			resolve({
				isResponding: false,
				error: err?.message || String(err),
			});
		});

		req.end();
	});
};

/**
 * Stage 3 Artifact verification: Ensures expected entrypoints or build outputs exist.
 */
export const verifyBuildArtifacts = (options: {
	buildDir: string;
	publishDir?: string;
	strategy: string;
}): { exists: boolean; path?: string; error?: string } => {
	const { buildDir, publishDir, strategy } = options;

	if (strategy === "static-artifact") {
		const targetDir = publishDir ? path.join(buildDir, publishDir) : path.join(buildDir, "dist");
		const altDir = path.join(buildDir, "build");
		if (fs.existsSync(targetDir)) {
			return { exists: true, path: targetDir };
		}
		if (fs.existsSync(altDir)) {
			return { exists: true, path: altDir };
		}
		return {
			exists: false,
			error: `Expected static output directory (${publishDir || "dist"} or build) not found after build.`,
		};
	}

	return { exists: true };
};
