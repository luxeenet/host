import { db } from "@dokploy/server/db";
import { account, apikey, invitation, member, passkey, user, } from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import * as bcrypt from "bcrypt";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "../lib/auth";
export const addNewProject = async (userId, projectId, organizationId) => {
    const userR = await findMemberById(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedProjects: [...userR.accessedProjects, projectId],
    })
        .where(and(eq(member.id, userR.id), eq(member.organizationId, organizationId)));
};
export const addNewEnvironment = async (userId, environmentId, organizationId) => {
    const userR = await findMemberById(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedEnvironments: [...userR.accessedEnvironments, environmentId],
    })
        .where(and(eq(member.id, userR.id), eq(member.organizationId, organizationId)));
};
export const addNewService = async (userId, serviceId, organizationId) => {
    const userR = await findMemberById(userId, organizationId);
    await db
        .update(member)
        .set({
        accessedServices: [...userR.accessedServices, serviceId],
    })
        .where(and(eq(member.id, userR.id), eq(member.organizationId, organizationId)));
};
export const canPerformCreationService = async (userId, projectId, organizationId) => {
    const { accessedProjects, canCreateServices } = await findMemberById(userId, organizationId);
    const haveAccessToProject = accessedProjects.includes(projectId);
    if (canCreateServices && haveAccessToProject) {
        return true;
    }
    return false;
};
export const canPerformAccessService = async (userId, serviceId, organizationId) => {
    const { accessedServices } = await findMemberById(userId, organizationId);
    const haveAccessToService = accessedServices.includes(serviceId);
    if (haveAccessToService) {
        return true;
    }
    return false;
};
export const canPerformDeleteService = async (userId, serviceId, organizationId) => {
    const { accessedServices, canDeleteServices } = await findMemberById(userId, organizationId);
    const haveAccessToService = accessedServices.includes(serviceId);
    if (canDeleteServices && haveAccessToService) {
        return true;
    }
    return false;
};
export const canPerformCreationProject = async (userId, organizationId) => {
    const { canCreateProjects } = await findMemberById(userId, organizationId);
    if (canCreateProjects) {
        return true;
    }
    return false;
};
export const canPerformDeleteProject = async (userId, organizationId) => {
    const { canDeleteProjects } = await findMemberById(userId, organizationId);
    if (canDeleteProjects) {
        return true;
    }
    return false;
};
export const canPerformAccessProject = async (userId, projectId, organizationId) => {
    const { accessedProjects } = await findMemberById(userId, organizationId);
    const haveAccessToProject = accessedProjects.includes(projectId);
    if (haveAccessToProject) {
        return true;
    }
    return false;
};
export const canPerformAccessEnvironment = async (userId, environmentId, organizationId) => {
    const { accessedEnvironments } = await findMemberById(userId, organizationId);
    const haveAccessToEnvironment = accessedEnvironments.includes(environmentId);
    if (haveAccessToEnvironment) {
        return true;
    }
    return false;
};
export const canPerformDeleteEnvironment = async (userId, projectId, organizationId) => {
    const { accessedProjects, canDeleteEnvironments } = await findMemberById(userId, organizationId);
    const haveAccessToProject = accessedProjects.includes(projectId);
    if (canDeleteEnvironments && haveAccessToProject) {
        return true;
    }
    return false;
};
export const canAccessToTraefikFiles = async (userId, organizationId) => {
    const { canAccessToTraefikFiles } = await findMemberById(userId, organizationId);
    return canAccessToTraefikFiles;
};
export const checkServiceAccess = async (userId, serviceId, organizationId, action = "access") => {
    let hasPermission = false;
    switch (action) {
        case "create":
            hasPermission = await canPerformCreationService(userId, serviceId, organizationId);
            break;
        case "access":
            hasPermission = await canPerformAccessService(userId, serviceId, organizationId);
            break;
        case "delete":
            hasPermission = await canPerformDeleteService(userId, serviceId, organizationId);
            break;
        default:
            hasPermission = false;
    }
    if (!hasPermission) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Permission denied",
        });
    }
};
export const checkEnvironmentAccess = async (userId, environmentId, organizationId, action = "access") => {
    let hasPermission = false;
    switch (action) {
        case "access":
            hasPermission = await canPerformAccessEnvironment(userId, environmentId, organizationId);
            break;
        default:
            hasPermission = false;
    }
    if (!hasPermission) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Permission denied",
        });
    }
};
export const checkEnvironmentDeletionPermission = async (userId, projectId, organizationId) => {
    const member = await findMemberById(userId, organizationId);
    if (!member) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User not found in organization",
        });
    }
    if (member.role === "owner" || member.role === "admin") {
        return true;
    }
    if (!member.canDeleteEnvironments) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You don't have permission to delete environments",
        });
    }
    const hasProjectAccess = member.accessedProjects.includes(projectId);
    if (!hasProjectAccess) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You don't have access to this project",
        });
    }
    return true;
};
export const checkProjectAccess = async (authId, action, organizationId, projectId) => {
    let hasPermission = false;
    switch (action) {
        case "access":
            hasPermission = await canPerformAccessProject(authId, projectId, organizationId);
            break;
        case "create":
            hasPermission = await canPerformCreationProject(authId, organizationId);
            break;
        case "delete":
            hasPermission = await canPerformDeleteProject(authId, organizationId);
            break;
        default:
            hasPermission = false;
    }
    if (!hasPermission) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Permission denied",
        });
    }
};
export const checkEnvironmentCreationPermission = async (userId, projectId, organizationId) => {
    // Get user's member record
    const member = await findMemberById(userId, organizationId);
    if (!member) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User not found in organization",
        });
    }
    // Owners and admins can always create environments
    if (member.role === "owner" || member.role === "admin") {
        return true;
    }
    // Check if user has canCreateEnvironments permission
    if (!member.canCreateEnvironments) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You don't have permission to create environments",
        });
    }
    // Check if user has access to the project
    const hasProjectAccess = member.accessedProjects.includes(projectId);
    if (!hasProjectAccess) {
        throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You don't have access to this project",
        });
    }
    return true;
};
export const findMemberById = async (userId, organizationId) => {
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
export const findPasskeysByUserId = async (userId) => {
    return db.query.passkey.findMany({
        where: eq(passkey.userId, userId),
        columns: {
            id: true,
            name: true,
            deviceType: true,
            backedUp: true,
            createdAt: true,
            aaguid: true,
        },
        orderBy: [desc(passkey.createdAt)],
    });
};
export const createOrganizationUserWithCredentials = async ({ organizationId, email, password, role, }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date();
    return await db.transaction(async (tx) => {
        const existingUser = await tx.query.user.findFirst({
            where: eq(user.email, normalizedEmail),
            columns: {
                id: true,
            },
        });
        if (existingUser) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This email already has an account. Use the invitation link flow for existing users.",
            });
        }
        const createdUser = await tx
            .insert(user)
            .values({
            email: normalizedEmail,
            emailVerified: true,
            updatedAt: now,
        })
            .returning({
            id: user.id,
            email: user.email,
        })
            .then((res) => res[0]);
        if (!createdUser) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Failed to create user",
            });
        }
        await tx.insert(account).values({
            userId: createdUser.id,
            providerId: "credential",
            password: bcrypt.hashSync(password, 10),
            createdAt: now,
            updatedAt: now,
        });
        await tx.insert(member).values({
            organizationId,
            userId: createdUser.id,
            role,
            createdAt: now,
            isDefault: true,
        });
        await tx
            .update(invitation)
            .set({
            status: "canceled",
        })
            .where(and(eq(invitation.organizationId, organizationId), eq(invitation.email, normalizedEmail), eq(invitation.status, "pending")));
        return {
            userId: createdUser.id,
            email: createdUser.email,
            role,
        };
    });
};
export const updateUser = async (userId, userData) => {
    // Validate email if it's being updated
    if (userData.email !== undefined) {
        if (!userData.email || userData.email.trim() === "") {
            throw new Error("Email is required and cannot be empty");
        }
        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            throw new Error("Please enter a valid email address");
        }
    }
    const userResult = await db
        .update(user)
        .set({
        ...userData,
    })
        .where(eq(user.id, userId))
        .returning()
        .then((res) => res[0]);
    return userResult;
};
export const createApiKey = async (userId, input) => {
    const result = await auth.createApiKey({
        body: {
            name: input.name,
            expiresIn: input.expiresIn,
            prefix: input.prefix,
            rateLimitEnabled: input.rateLimitEnabled,
            rateLimitTimeWindow: input.rateLimitTimeWindow,
            rateLimitMax: input.rateLimitMax,
            remaining: input.remaining,
            refillAmount: input.refillAmount,
            refillInterval: input.refillInterval,
            userId,
        },
    });
    if (input.metadata) {
        await db
            .update(apikey)
            .set({ metadata: JSON.stringify(input.metadata) })
            .where(eq(apikey.id, result.id));
    }
    return result;
};
