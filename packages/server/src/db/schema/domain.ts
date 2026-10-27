import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { domain } from "../validations/domain";
import { applications } from "./application";
import { compose } from "./compose";
import { previewDeployments } from "./preview-deployments";
import { certificateType } from "./shared";

export const domainType = pgEnum("domainType", [
	"compose",
	"application",
	"preview",
]);

export const domains = pgTable(
	"domain",
	{
	domainId: text("domainId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	host: text("host").notNull(),
	https: boolean("https").notNull().default(false),
	port: integer("port").default(3000),
	customEntrypoint: text("customEntrypoint"),
	path: text("path").default("/"),
	serviceName: text("serviceName"),
	domainType: domainType("domainType").default("application"),
	uniqueConfigKey: serial("uniqueConfigKey"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	composeId: text("composeId").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	customCertResolver: text("customCertResolver"),
	applicationId: text("applicationId").references(
		() => applications.applicationId,
		{ onDelete: "cascade" },
	),
	previewDeploymentId: text("previewDeploymentId").references(
		(): AnyPgColumn => previewDeployments.previewDeploymentId,
		{ onDelete: "cascade" },
	),
	certificateType: certificateType("certificateType").notNull().default("none"),
	internalPath: text("internalPath").default("/"),
	stripPath: boolean("stripPath").notNull().default(false),
	middlewares: text("middlewares").array().default(sql`ARRAY[]::text[]`),
	forwardAuthEnabled: boolean("forwardAuthEnabled").notNull().default(false),
	enabled: boolean("enabled").notNull().default(true),
	/** Canonical domain for the service; at most one per application/compose. */
	isPrimary: boolean("isPrimary").notNull().default(false),
	/** Cloudflare for SaaS custom hostname ID. */
	cfHostnameId: text("cfHostnameId"),
	/** Provider hostname status: pending | active | blocked | pending_migration | pending_deletion */
	cfStatus: text("cfStatus"),
	/** Provider SSL status: initializing | pending_validation | pending_issuance | pending_deployment | active | error */
	cfSslStatus: text("cfSslStatus"),
	/** Verification errors returned by Cloudflare */
	cfVerificationErrors: jsonb("cfVerificationErrors")
		.$type<string[]>()
		.default(sql`'[]'::jsonb`),
	/** Cloudflare ownership verification record (TXT / HTTP challenge) */
	cfOwnershipVerification: jsonb("cfOwnershipVerification").$type<
		Record<string, unknown>
	>(),
	/** Cloudflare SSL validation records (TXT / CNAME / HTTP DCV challenges) */
	cfSslValidationRecords: jsonb("cfSslValidationRecords").$type<
		Array<Record<string, unknown>>
	>(),
	/** Issued certificate metadata */
	cfSslCertificates: jsonb("cfSslCertificates").$type<
		Array<Record<string, unknown>>
	>(),
	/** Timestamp of last Cloudflare status synchronization */
	cfLastSyncAt: timestamp("cfLastSyncAt"),
	/** Error message from last Cloudflare API interaction */
	cfLastError: text("cfLastError"),
	/** Optional custom origin server for Cloudflare to route to */
	cfCustomOrigin: text("cfCustomOrigin"),
	},
	(t) => ({
		primaryPerApplication: uniqueIndex("domain_primary_per_application")
			.on(t.applicationId)
			.where(sql`${t.isPrimary} = true AND ${t.applicationId} IS NOT NULL`),
		primaryPerCompose: uniqueIndex("domain_primary_per_compose")
			.on(t.composeId)
			.where(sql`${t.isPrimary} = true AND ${t.composeId} IS NOT NULL`),
	}),
);

export const domainsRelations = relations(domains, ({ one }) => ({
	application: one(applications, {
		fields: [domains.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [domains.composeId],
		references: [compose.composeId],
	}),
	previewDeployment: one(previewDeployments, {
		fields: [domains.previewDeploymentId],
		references: [previewDeployments.previewDeploymentId],
	}),
}));

const createSchema = createInsertSchema(domains, {
	...domain.shape,
	// Override pgEnum so Zod 4 infers only string literals, not numeric enum index
	domainType: z.enum(["compose", "application", "preview"]).optional(),
});

export const apiCreateDomain = createSchema.pick({
	host: true,
	path: true,
	port: true,
	customEntrypoint: true,
	https: true,
	applicationId: true,
	certificateType: true,
	customCertResolver: true,
	composeId: true,
	serviceName: true,
	domainType: true,
	previewDeploymentId: true,
	internalPath: true,
	stripPath: true,
	middlewares: true,
	forwardAuthEnabled: true,
});

export const apiFindDomain = z.object({
	domainId: z.string().min(1),
});

export const apiFindDomainByApplication = createSchema.pick({
	applicationId: true,
});

export const apiCreateTraefikMeDomain = createSchema.pick({}).extend({
	appName: z.string().min(1),
});

export const apiFindDomainByCompose = createSchema.pick({
	composeId: true,
});

export const apiUpdateDomain = createSchema
	.pick({
		host: true,
		path: true,
		port: true,
		customEntrypoint: true,
		https: true,
		certificateType: true,
		customCertResolver: true,
		serviceName: true,
		domainType: true,
		internalPath: true,
		stripPath: true,
		middlewares: true,
		forwardAuthEnabled: true,
		enabled: true,
	})
	.merge(createSchema.pick({ domainId: true }).required());
