import fs from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { CustomerStorageService } from "@dokploy/server";
import { validateRequest } from "@dokploy/server/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== "GET") {
		res.setHeader("Allow", ["GET"]);
		return res.status(405).json({ message: "Method Not Allowed" });
	}

	try {
		const { session } = await validateRequest(req);
		if (!session || !session.activeOrganizationId) {
			return res.status(401).json({ message: "Unauthorized. Active session required." });
		}

		const filePath = (req.query.path as string) || "";
		if (!filePath) {
			return res.status(400).json({ message: "Query parameter 'path' is required." });
		}

		const storageRoot = CustomerStorageService.getTenantStorageRoot(
			session.activeOrganizationId,
		);
		const fullPath = CustomerStorageService.resolveSafePath(storageRoot, filePath);

		if (!fs.existsSync(fullPath)) {
			return res.status(404).json({ message: "File not found." });
		}

		const stat = fs.statSync(fullPath);
		if (stat.isDirectory()) {
			return res.status(400).json({ message: "Cannot download directory directly. Use folder archive." });
		}

		const fileName = path.basename(fullPath);
		// Sanitize header filename (prevent header injection)
		const sanitizedFileName = fileName.replace(/["\r\n]/g, "_");

		res.setHeader("Content-Disposition", `attachment; filename="${sanitizedFileName}"`);
		res.setHeader("Content-Type", "application/octet-stream");
		res.setHeader("Content-Length", stat.size);
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Content-Security-Policy", "default-src 'none'");

		const stream = fs.createReadStream(fullPath);
		stream.pipe(res);
	} catch (err: any) {
		console.error("[Storage Download] Error:", err?.message);
		const statusCode = err?.code === "FORBIDDEN" ? 403 : 500;
		return res.status(statusCode).json({ message: err?.message || "Internal Server Error" });
	}
}
