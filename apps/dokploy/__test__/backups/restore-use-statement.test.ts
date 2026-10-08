import { execSync } from "node:child_process";
import {
	getRestoreCommand,
	stripDatabaseSwitchCommand,
} from "@dokploy/server/utils/restore/utils";
import { describe, expect, it } from "vitest";

const hasBash = () => {
	if (process.platform === "win32") return false;
	try {
		execSync("bash -c 'exit 0'", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
};

const filter = (input: string) => {
	if (!hasBash()) return "";
	return execSync(stripDatabaseSwitchCommand, {
		input,
		shell: process.platform === "win32" ? "bash" : "/bin/bash",
	}).toString();
};

describe("restore drops database-switch statements (mysql/mariadb)", () => {
	const dump = [
		"-- MariaDB dump",
		"CREATE DATABASE /*!32312 IF NOT EXISTS*/ `production_db`;",
		"USE `production_db`;",
		"use production_db;",
		"DROP TABLE IF EXISTS `users`;",
		"CREATE TABLE `users` (`id` int NOT NULL);",
		"INSERT INTO `users` VALUES (1),(2);",
		"INSERT INTO `logs` VALUES ('USER: because'),('CREATE DATABASE is a string');",
	].join("\n");

	it.skipIf(!hasBash())(
		"removes USE and CREATE DATABASE lines but keeps everything else",
		() => {
		const result = filter(dump);
		expect(result).not.toContain("USE `production_db`");
		expect(result).not.toContain("use production_db");
		expect(result).not.toContain("CREATE DATABASE /*!32312");
		expect(result).toContain("DROP TABLE IF EXISTS `users`;");
		expect(result).toContain("CREATE TABLE `users` (`id` int NOT NULL);");
		expect(result).toContain("INSERT INTO `users` VALUES (1),(2);");
		expect(result).toContain(
			"INSERT INTO `logs` VALUES ('USER: because'),('CREATE DATABASE is a string');",
		);
	});

	it("is wired into mysql and mariadb restore pipelines only", () => {
		const base = {
			appName: "my-app",
			restoreType: "database" as const,
			credentials: {
				database: "dev_db",
				databaseUser: "u",
				databasePassword: "p",
			},
			rcloneCommand: "rclone cat ':s3:bucket/file.sql.gz' | gunzip",
		};
		for (const type of ["mysql", "mariadb"] as const) {
			const cmd = getRestoreCommand({ ...base, type });
			expect(cmd).toContain(`gunzip | ${stripDatabaseSwitchCommand} | docker`);
		}
		const pgCmd = getRestoreCommand({ ...base, type: "postgres" });
		expect(pgCmd).not.toContain(stripDatabaseSwitchCommand);
	});
});
