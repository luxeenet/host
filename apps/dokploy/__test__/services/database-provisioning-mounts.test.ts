import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMount, findMountById } from "@dokploy/server/services/mount";
import { PlanEntitlementService } from "@dokploy/server/services/plan-entitlement";
import { createLibsql } from "@dokploy/server/services/libsql";
import { addNewService, findMemberByUserId } from "@dokploy/server/services/permission";

describe("Database Provisioning, Mounts & Plan Entitlements across all 6 Database Types", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe("1. Shared Mount Creation & Transaction Propagation (All 6 Database Types)", () => {
		it("creates a valid PostgreSQL mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-pg-1",
							type: "volume",
							serviceType: "postgres",
							postgresId: "pg-123",
							mountPath: "/var/lib/postgresql/data",
							volumeName: "pg-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-pg-1",
							type: "volume",
							serviceType: "postgres",
							postgresId: "pg-123",
							mountPath: "/var/lib/postgresql/data",
							volumeName: "pg-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "postgres",
				serviceId: "pg-123",
				mountPath: "/var/lib/postgresql/data",
				volumeName: "pg-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.postgresId).toBe("pg-123");
			expect(mount.serviceType).toBe("postgres");
			expect(mount.mountPath).toBe("/var/lib/postgresql/data");
			expect(mount.volumeName).toBe("pg-app-data");
		});

		it("creates a valid MySQL mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-mysql-1",
							type: "volume",
							serviceType: "mysql",
							mysqlId: "mysql-123",
							mountPath: "/var/lib/mysql",
							volumeName: "mysql-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-mysql-1",
							type: "volume",
							serviceType: "mysql",
							mysqlId: "mysql-123",
							mountPath: "/var/lib/mysql",
							volumeName: "mysql-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "mysql",
				serviceId: "mysql-123",
				mountPath: "/var/lib/mysql",
				volumeName: "mysql-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.mysqlId).toBe("mysql-123");
			expect(mount.serviceType).toBe("mysql");
			expect(mount.mountPath).toBe("/var/lib/mysql");
			expect(mount.volumeName).toBe("mysql-app-data");
		});

		it("creates a valid MariaDB mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-maria-1",
							type: "volume",
							serviceType: "mariadb",
							mariadbId: "maria-123",
							mountPath: "/var/lib/mysql",
							volumeName: "maria-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-maria-1",
							type: "volume",
							serviceType: "mariadb",
							mariadbId: "maria-123",
							mountPath: "/var/lib/mysql",
							volumeName: "maria-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "mariadb",
				serviceId: "maria-123",
				mountPath: "/var/lib/mysql",
				volumeName: "maria-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.mariadbId).toBe("maria-123");
			expect(mount.serviceType).toBe("mariadb");
			expect(mount.mountPath).toBe("/var/lib/mysql");
		});

		it("creates a valid MongoDB mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-mongo-1",
							type: "volume",
							serviceType: "mongo",
							mongoId: "mongo-123",
							mountPath: "/data/db",
							volumeName: "mongo-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-mongo-1",
							type: "volume",
							serviceType: "mongo",
							mongoId: "mongo-123",
							mountPath: "/data/db",
							volumeName: "mongo-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "mongo",
				serviceId: "mongo-123",
				mountPath: "/data/db",
				volumeName: "mongo-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.mongoId).toBe("mongo-123");
			expect(mount.serviceType).toBe("mongo");
			expect(mount.mountPath).toBe("/data/db");
		});

		it("creates a valid Redis mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-redis-1",
							type: "volume",
							serviceType: "redis",
							redisId: "redis-123",
							mountPath: "/data",
							volumeName: "redis-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-redis-1",
							type: "volume",
							serviceType: "redis",
							redisId: "redis-123",
							mountPath: "/data",
							volumeName: "redis-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "redis",
				serviceId: "redis-123",
				mountPath: "/data",
				volumeName: "redis-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.redisId).toBe("redis-123");
			expect(mount.serviceType).toBe("redis");
			expect(mount.mountPath).toBe("/data");
		});

		it("creates a valid LibSQL mount using transaction executor", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							mountId: "mount-libsql-1",
							type: "volume",
							serviceType: "libsql",
							libsqlId: "libsql-123",
							mountPath: "/var/lib/sqld",
							volumeName: "libsql-app-data",
						}]),
					}),
				}),
				query: {
					mounts: {
						findFirst: vi.fn().mockResolvedValue({
							mountId: "mount-libsql-1",
							type: "volume",
							serviceType: "libsql",
							libsqlId: "libsql-123",
							mountPath: "/var/lib/sqld",
							volumeName: "libsql-app-data",
						}),
					},
				},
			};

			const mount = await createMount({
				type: "volume",
				serviceType: "libsql",
				serviceId: "libsql-123",
				mountPath: "/var/lib/sqld",
				volumeName: "libsql-app-data",
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(mount).toBeDefined();
			expect(mount.libsqlId).toBe("libsql-123");
			expect(mount.serviceType).toBe("libsql");
			expect(mount.mountPath).toBe("/var/lib/sqld");
		});
	});

	describe("2. Permission & Member Service Transaction Propagation", () => {
		it("addNewService propagates transaction to findMemberByUserId and member update", async () => {
			const mockTx = {
				query: {
					member: {
						findFirst: vi.fn().mockResolvedValue({
							id: "mem-1",
							userId: "usr-1",
							organizationId: "org-1",
							accessedServices: [],
						}),
					},
				},
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue(undefined),
					}),
				}),
			};

			const mockCtx = {
				user: { id: "usr-1" },
				session: { activeOrganizationId: "org-1" },
			};
			await addNewService(mockCtx, "service-123", mockTx as any);
			expect(mockTx.query.member.findFirst).toHaveBeenCalled();
			expect(mockTx.update).toHaveBeenCalled();
		});
	});

	describe("3. LibSQL Creation with Transaction & Name Validation", () => {
		it("createLibsql correctly creates record within transaction", async () => {
			const mockTx = {
				insert: vi.fn().mockReturnValue({
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{
							libsqlId: "libsql-abc",
							name: "my-libsql-db",
							appName: "my-libsql-app",
							environmentId: "env-1",
						}]),
					}),
				}),
			};

			const result = await createLibsql({
				name: "my-libsql-db",
				appName: "my-libsql-app",
				environmentId: "env-1",
				databasePassword: "secret-password",
				databaseUser: "libsql",
				dockerImage: "ghcr.io/tursodatabase/libsql-server:latest",
				enableNamespaces: false,
				sqldNode: "primary",
				sqldPrimaryUrl: null,
				serverId: null,
				description: null,
			}, mockTx as any);

			expect(mockTx.insert).toHaveBeenCalled();
			expect(result.libsqlId).toBe("libsql-abc");
			expect(result.name).toBe("my-libsql-db");
		});
	});

	describe("4. Plan Entitlement Quota Enforcement includes LibSQL and All Engines", () => {
		it("counts LibSQL alongside other 5 database types when calculating quota", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "starter",
				planName: "Starter",
				resources: {
					max_projects: 5,
					max_applications: 5,
					max_databases: 3,
					max_domains: 5,
					max_team_members: 1,
					max_ram_mb: 1024,
					max_cpu_millicores: 1000,
					max_storage_gb: 10,
					backup_storage_gb: 5,
				},
				features: {
					databases: true,
					custom_domains: true,
					team_members: false,
					backups: true,
				},
				applicationTypes: ["node", "docker"],
				subscriptionStatus: "active",
			});

			// Mock query returning counts for each of the 6 database types:
			// 1 postgres, 1 mysql, 0 mariadb, 0 mongo, 0 redis, 1 libsql = 3 total (at limit of 3)
			const countResults = [
				[{ value: 1 }], // postgres
				[{ value: 1 }], // mysql
				[{ value: 0 }], // mariadb
				[{ value: 0 }], // mongo
				[{ value: 0 }], // redis
				[{ value: 1 }], // libsql (CRITICAL: must be counted!)
			];
			let callIndex = 0;
			const mockExecutor = {
				select: vi.fn().mockImplementation(() => ({
					from: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							innerJoin: vi.fn().mockReturnValue({
								where: vi.fn().mockImplementation(async () => {
									const res = countResults[callIndex] || [{ value: 0 }];
									callIndex++;
									return res;
								}),
							}),
						}),
					}),
				})),
			};

			const check = await PlanEntitlementService.checkCanCreateDatabase("org-1", mockExecutor);
			expect(check.allowed).toBe(false);
			expect(check.reason).toContain("maximum of 3 databases");
		});

		it("allows database creation when count across all 6 types is below quota", async () => {
			vi.spyOn(PlanEntitlementService, "checkSubscriptionActive").mockResolvedValue({
				allowed: true,
			});
			vi.spyOn(PlanEntitlementService, "getPlanSnapshot").mockResolvedValue({
				planId: "pro",
				planName: "Pro",
				resources: {
					max_projects: 10,
					max_applications: 10,
					max_databases: 5,
					max_domains: 10,
					max_team_members: 5,
					max_ram_mb: 4096,
					max_cpu_millicores: 4000,
					max_storage_gb: 50,
					backup_storage_gb: 20,
				},
				features: {
					databases: true,
					custom_domains: true,
					team_members: true,
					backups: true,
				},
				applicationTypes: ["node", "docker"],
				subscriptionStatus: "active",
			});

			// Total databases: 1 pg + 1 mysql = 2 (< 5)
			const countResults = [
				[{ value: 1 }], // pg
				[{ value: 1 }], // mysql
				[{ value: 0 }], // mariadb
				[{ value: 0 }], // mongo
				[{ value: 0 }], // redis
				[{ value: 0 }], // libsql
			];
			let callIndex = 0;
			const mockExecutor = {
				select: vi.fn().mockImplementation(() => ({
					from: vi.fn().mockReturnValue({
						innerJoin: vi.fn().mockReturnValue({
							innerJoin: vi.fn().mockReturnValue({
								where: vi.fn().mockImplementation(async () => {
									const res = countResults[callIndex] || [{ value: 0 }];
									callIndex++;
									return res;
								}),
							}),
						}),
					}),
				})),
			};

			const check = await PlanEntitlementService.checkCanCreateDatabase("org-1", mockExecutor);
			expect(check.allowed).toBe(true);
		});
	});
});
