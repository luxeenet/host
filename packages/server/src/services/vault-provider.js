import { db } from "@dokploy/server/db";
import { projects, vaultProvider, } from "@dokploy/server/db/schema";
import { getVaultClient } from "@dokploy/server/utils/vault";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
export const VAULT_SECRET_MASK = "********";
const SENSITIVE_FIELDS = {
    hashicorp: ["token"],
    infisical: ["clientSecret"],
    aws: ["secretAccessKey"],
    "aws-parameter-store": ["secretAccessKey"],
    doppler: ["serviceToken"],
    azure: ["clientSecret"],
    scaleway: ["secretKey"],
    phase: ["token"],
};
export const maskVaultProviderConfig = (config) => {
    const masked = { ...config };
    for (const field of SENSITIVE_FIELDS[config.providerType]) {
        if (masked[field]) {
            masked[field] = VAULT_SECRET_MASK;
        }
    }
    return masked;
};
export const mergeVaultProviderConfig = (incoming, existing) => {
    const merged = { ...incoming };
    for (const field of SENSITIVE_FIELDS[incoming.providerType]) {
        if (merged[field] === VAULT_SECRET_MASK) {
            if (incoming.providerType !== existing.providerType) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Credentials must be re-entered when changing the provider type",
                });
            }
            merged[field] = existing[field];
        }
    }
    return merged;
};
const isUniqueNameViolation = (error) => error instanceof Error &&
    error.message.includes("vault_provider_org_name_idx");
const validateAssignments = async (assignments, organizationId) => {
    const orgProjects = await db.query.projects.findMany({
        where: eq(projects.organizationId, organizationId),
        with: { environments: true },
    });
    for (const assignment of assignments) {
        const project = orgProjects.find((p) => p.projectId === assignment.projectId);
        if (!project) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Assignment references a project outside this organization",
            });
        }
        const environmentIds = new Set(project.environments.map((e) => e.environmentId));
        for (const environmentId of assignment.environmentIds) {
            if (!environmentIds.has(environmentId)) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Assignment references an environment outside the selected project",
                });
            }
        }
    }
};
export const createVaultProvider = async (input, organizationId) => {
    await validateAssignments(input.assignments, organizationId);
    try {
        const newProvider = await db
            .insert(vaultProvider)
            .values({
            name: input.name,
            providerType: input.config.providerType,
            config: input.config,
            assignments: input.assignments,
            organizationId,
        })
            .returning()
            .then((value) => value[0]);
        if (!newProvider) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Error creating the vault provider",
            });
        }
        return newProvider;
    }
    catch (error) {
        if (isUniqueNameViolation(error)) {
            throw new TRPCError({
                code: "CONFLICT",
                message: `A vault provider named "${input.name}" already exists in this organization`,
            });
        }
        throw error;
    }
};
export const findVaultProviderById = async (vaultProviderId) => {
    const provider = await db.query.vaultProvider.findFirst({
        where: eq(vaultProvider.vaultProviderId, vaultProviderId),
    });
    if (!provider) {
        throw new TRPCError({
            code: "NOT_FOUND",
            message: "Vault provider not found",
        });
    }
    return provider;
};
export const findVaultProviderInOrganization = async (vaultProviderId, organizationId) => {
    const provider = await findVaultProviderById(vaultProviderId);
    if (provider.organizationId !== organizationId) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You are not allowed to access this vault provider",
        });
    }
    return provider;
};
export const findVaultProvidersByOrganizationId = async (organizationId) => {
    return await db.query.vaultProvider.findMany({
        where: eq(vaultProvider.organizationId, organizationId),
        orderBy: (providers, { asc }) => [asc(providers.name)],
    });
};
export const updateVaultProvider = async (vaultProviderId, name, config, assignments) => {
    const existing = await findVaultProviderById(vaultProviderId);
    const mergedConfig = mergeVaultProviderConfig(config, existing.config);
    await validateAssignments(assignments, existing.organizationId);
    try {
        const updated = await db
            .update(vaultProvider)
            .set({
            name,
            providerType: mergedConfig.providerType,
            config: mergedConfig,
            assignments,
        })
            .where(eq(vaultProvider.vaultProviderId, vaultProviderId))
            .returning()
            .then((res) => res[0]);
        if (!updated) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Error updating the vault provider",
            });
        }
        return updated;
    }
    catch (error) {
        if (isUniqueNameViolation(error)) {
            throw new TRPCError({
                code: "CONFLICT",
                message: `A vault provider named "${name}" already exists in this organization`,
            });
        }
        throw error;
    }
};
export const removeVaultProvider = async (vaultProviderId) => {
    const removed = await db
        .delete(vaultProvider)
        .where(eq(vaultProvider.vaultProviderId, vaultProviderId))
        .returning()
        .then((res) => res[0]);
    if (!removed) {
        throw new TRPCError({
            code: "NOT_FOUND",
            message: "Vault provider not found",
        });
    }
    return removed;
};
export const testVaultProviderConnection = async (config) => {
    const client = getVaultClient(config.providerType);
    try {
        await client.testConnection(config);
    }
    catch (error) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error
                ? error.message
                : "Error connecting to the vault provider",
        });
    }
};
export const listVaultProviderSecretNames = async (config) => {
    const client = getVaultClient(config.providerType);
    if (!client.listSecretNames) {
        return [];
    }
    try {
        return await client.listSecretNames(config);
    }
    catch {
        return [];
    }
};
