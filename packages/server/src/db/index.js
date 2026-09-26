import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dbUrl } from "./constants";
import * as schema from "./schema";
export { and, eq };
export * from "./schema";
// Este módulo se evalúa varias veces por proceso (copias duplicadas por
// esbuild y los chunks de Next); el cache en globalThis garantiza un solo
// pool de conexiones por proceso.
const globalForDb = globalThis;
if (!globalForDb.db) {
    globalForDb.db = drizzle(postgres(dbUrl), {
        schema,
    });
}
export const db = globalForDb.db;
export { dbUrl };
