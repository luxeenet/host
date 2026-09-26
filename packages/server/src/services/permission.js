import { db } from "@dokploy/server/db";
import { member, organizationRole } from "@dokploy/server/db/schema";
import { hasValidLicense } from "@dokploy/server/services/proprietary/license-key";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { ac, adminRole, enterpriseOnlyResources, memberRole, ownerRole, statements, } from "../lib/access-control";
const staticRoles = {
    owner: ownerRole,
    admin: adminRole,
    member: memberRole,
};
const resolveRole = async (roleName, organizationId) => {
    if (staticRoles[roleName]) {
        return staticRoles[roleName];
    }
    const licensed = await hasValidLicense(organizationId);
    if (!licensed) {
        return null;
    }
    const customRoles = await db.query.organizationRole.findMany({
        where: and(eq(organizationRole.organizationId, organizationId), eq(organizationRole.role, roleName)),
    });
    if (customRoles.length === 0) {
        return null;
    }
    const merged = {};
    for (const entry of customRoles) {
        const parsed = JSON.parse(entry.permission);
        for (const [resource, actions] of Object.entries(parsed)) {
            merged[resource] = [
                ...new Set([...(merged[resource] ?? []), ...actions]),
            ];
        }
    }
    return ac.newRole(merged);
};
export const checkPermission = async (ctx, permissions) => {
    const { id: userId } = ctx.user;
    const { activeOrganizationId: organizationId } = ctx.session;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    const isPrivilegedStaticRole = memberRecord.role === "owner" || memberRecord.role === "admin";
    if (isPrivilegedStaticRole) {
        const allEnterprise = Object.keys(permissions).every((r) => enterpriseOnlyResources.has(r));
        if (allEnterprise)
            return;
    }
    const role = await resolveRole(memberRecord.role, organizationId);
    if (!role) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid role",
        });
    }
    const result = role.authorize(permissions);
    if (result.success) {
        return;
    }
    if (memberRecord.role === "member") {
        const overrides = getLegacyOverrides(memberRecord);
        const allGranted = Object.entries(permissions).every(([resource, actions]) => actions.every((action) => !!overrides[resource]?.[action]));
        if (allGranted) {
            return;
        }
    }
    throw new TRPCError({
        code: "UNAUTHORIZED",
        message: result.error || "Permission denied",
    });
};
export const hasPermission = async (ctx, permissions) => {
    try {
        await checkPermission(ctx, permissions);
        return true;
    }
    catch {
        return false;
    }
};
const getLegacyOverrides = (memberRecord) => {
    return {
        project: {
            create: !!memberRecord.canCreateProjects,
            delete: !!memberRecord.canDeleteProjects,
        },
        service: {
            create: !!memberRecord.canCreateServices,
            delete: !!memberRecord.canDeleteServices,
        },
        environment: {
            create: !!memberRecord.canCreateEnvironments,
            delete: !!memberRecord.canDeleteEnvironments,
        },
        traefikFiles: {
            read: !!memberRecord.canAccessToTraefikFiles,
        },
        docker: {
            read: !!memberRecord.canAccessToDocker,
        },
        api: {
            read: !!memberRecord.canAccessToAPI,
        },
        sshKeys: {
            read: !!memberRecord.canAccessToSSHKeys,
            create: !!memberRecord.canAccessToSSHKeys,
            delete: !!memberRecord.canAccessToSSHKeys,
        },
        gitProviders: {
            read: !!memberRecord.canAccessToGitProviders,
            create: !!memberRecord.canAccessToGitProviders,
            delete: !!memberRecord.canAccessToGitProviders,
        },
    };
};
export const resolvePermissions = async (ctx) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    const role = await resolveRole(memberRecord.role, organizationId);
    const legacyOverrides = memberRecord.role === "member" ? getLegacyOverrides(memberRecord) : {};
    const isPrivilegedRole = memberRecord.role === "owner" || memberRecord.role === "admin";
    const result = {};
    for (const [resource, actions] of Object.entries(statements)) {
        const resourcePerms = {};
        for (const action of actions) {
            if (isPrivilegedRole && enterpriseOnlyResources.has(resource)) {
                resourcePerms[action] = true;
                continue;
            }
            if (!role) {
                resourcePerms[action] = false;
                continue;
            }
            const check = role.authorize({ [resource]: [action] });
            resourcePerms[action] =
                check.success ||
                    !!legacyOverrides[resource]?.[action];
        }
        result[resource] = resourcePerms;
    }
    return result;
};
export const checkProjectAccess = async (ctx, action, projectId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, { project: [action] });
    if (action !== "create" &&
        projectId &&
        memberRecord.role !== "owner" &&
        memberRecord.role !== "admin") {
        if (!memberRecord.accessedProjects.includes(projectId)) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You don't have access to this project",
            });
        }
    }
};
export const checkServicePermissionAndAccess = async (ctx, serviceId, permissions) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, permissions);
    if (memberRecord.role !== "owner" && memberRecord.role !== "admin") {
        if (!memberRecord.accessedServices.includes(serviceId)) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You don't have access to this service",
            });
        }
    }
};
export const checkServiceAccess = async (ctx, serviceId, action = "read") => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, { service: [action] });
    if (memberRecord.role !== "owner" && memberRecord.role !== "admin") {
        if (action === "create") {
            if (!memberRecord.accessedProjects.includes(serviceId)) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "You don't have access to this project",
                });
            }
        }
        else {
            if (!memberRecord.accessedServices.includes(serviceId)) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "You don't have access to this service",
                });
            }
        }
    }
};
export const checkEnvironmentAccess = async (ctx, environmentId, action = "read") => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, { environment: [action] });
    if (action !== "create" &&
        memberRecord.role !== "owner" &&
        memberRecord.role !== "admin") {
        if (!memberRecord.accessedEnvironments.includes(environmentId)) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You don't have access to this environment",
            });
        }
    }
};
export const checkEnvironmentCreationPermission = async (ctx, projectId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, { environment: ["create"] });
    if (memberRecord.role !== "owner" && memberRecord.role !== "admin") {
        if (!memberRecord.accessedProjects.includes(projectId)) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You don't have access to this project",
            });
        }
    }
};
export const checkEnvironmentDeletionPermission = async (ctx, projectId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await checkPermission(ctx, { environment: ["delete"] });
    if (memberRecord.role !== "owner" && memberRecord.role !== "admin") {
        if (!memberRecord.accessedProjects.includes(projectId)) {
            throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "You don't have access to this project",
            });
        }
    }
};
export const addNewProject = async (ctx, projectId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedProjects: [...memberRecord.accessedProjects, projectId],
    })
        .where(and(eq(member.id, memberRecord.id), eq(member.organizationId, organizationId)));
};
export const addNewEnvironment = async (ctx, environmentId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedEnvironments: [
            ...memberRecord.accessedEnvironments,
            environmentId,
        ],
    })
        .where(and(eq(member.id, memberRecord.id), eq(member.organizationId, organizationId)));
};
export const addNewService = async (ctx, serviceId) => {
    const userId = ctx.user.id;
    const organizationId = ctx.session.activeOrganizationId;
    const memberRecord = await findMemberByUserId(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedServices: [...memberRecord.accessedServices, serviceId],
    })
        .where(and(eq(member.id, memberRecord.id), eq(member.organizationId, organizationId)));
};
export const findMemberByUserId = async (userId, organizationId) => {
    const result = await db.query.member.findFirst({
        where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
        with: {
            user: true,
        },
    });
    if (!result) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Permission denied",
        });
    }
    return result;
};
