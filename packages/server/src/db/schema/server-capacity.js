/**
 * Server capacity tracking schema.
 * Tracks reserved vs available resources per server.
 * Prevents over-provisioning of the hosting infrastructure.
 */
import { relations } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { server } from "./server";
export const serverCapacity = pgTable("paas_server_capacity", {
    id: text("id")
        .notNull()
        .primaryKey()
        .$defaultFn(() => nanoid()),
    serverId: text("server_id")
        .notNull()
        .unique()
        .references(() => server.serverId, { onDelete: "cascade" }),
    /** Total CPU cores */
    cpuCores: integer("cpu_cores").notNull().default(0),
    /** Total RAM in MB */
    ramMb: integer("ram_mb").notNull().default(0),
    /** Total disk in GB */
    diskGb: integer("disk_gb").notNull().default(0),
    /** Reserved RAM (sum of all application memoryReservation) in MB */
    reservedRamMb: integer("reserved_ram_mb").notNull().default(0),
    /** Reserved CPU in millicores */
    reservedCpuMillicores: integer("reserved_cpu_millicores").notNull().default(0),
    /** Reserved disk in GB */
    reservedDiskGb: integer("reserved_disk_gb").notNull().default(0),
    /** Safety headroom percentage (0–100) — never allocate beyond this */
    safetyReservePercent: integer("safety_reserve_percent").notNull().default(20),
    /** Current live metrics snapshot from monitoring agent */
    currentMetrics: jsonb("current_metrics"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const serverCapacityRelations = relations(serverCapacity, ({ one }) => ({
    server: one(server, {
        fields: [serverCapacity.serverId],
        references: [server.serverId],
    }),
}));
export const apiUpdateServerCapacity = z.object({
    serverId: z.string().min(1),
    cpuCores: z.number().int().min(0).optional(),
    ramMb: z.number().int().min(0).optional(),
    diskGb: z.number().int().min(0).optional(),
    safetyReservePercent: z.number().int().min(0).max(50).optional(),
});
