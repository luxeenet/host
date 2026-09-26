import { DescribeParametersCommand, GetParametersCommand, paginateDescribeParameters, SSMClient, } from "@aws-sdk/client-ssm";
const MAX_PARAMETERS_PER_REQUEST = 10;
const normalizeParameterPath = (path) => {
    const trimmed = path?.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed === "/") {
        return trimmed;
    }
    return trimmed.replace(/\/+$/, "");
};
const describeParametersInput = (config) => {
    const parameterPath = normalizeParameterPath(config.parameterPath);
    return parameterPath
        ? {
            ParameterFilters: [
                {
                    Key: "Path",
                    Option: "Recursive",
                    Values: [parameterPath],
                },
            ],
        }
        : {};
};
const isAccessDeniedError = (error) => error instanceof Error &&
    (error.name === "AccessDeniedException" || error.name === "AccessDenied");
const createClient = (config) => new SSMClient({
    region: config.region,
    credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
});
const findRequestedRef = (refs, parameter) => {
    const bases = [parameter.Name, parameter.ARN].filter((value) => Boolean(value));
    if (!parameter.Selector) {
        return refs.find((ref) => bases.includes(ref));
    }
    const selector = parameter.Name
        ? parameter.Selector.replace(`${parameter.Name}:`, "").replace(/^:/, "")
        : parameter.Selector.replace(/^:/, "");
    return refs.find((ref) => bases.some((base) => ref === `${base}:${selector}`));
};
export const awsParameterStoreClient = {
    async getSecrets(config, refs) {
        const client = createClient(config);
        const uniqueRefs = [...new Set(refs)];
        const result = {};
        for (let index = 0; index < uniqueRefs.length; index += MAX_PARAMETERS_PER_REQUEST) {
            const batch = uniqueRefs.slice(index, index + MAX_PARAMETERS_PER_REQUEST);
            const response = await client.send(new GetParametersCommand({
                Names: batch,
                WithDecryption: true,
            }));
            for (const parameter of response.Parameters ?? []) {
                const ref = findRequestedRef(batch, parameter);
                if (!ref) {
                    continue;
                }
                if (parameter.Value === undefined) {
                    throw new Error(`AWS Parameter Store: parameter "${ref}" has no value`);
                }
                result[ref] = parameter.Value;
            }
        }
        for (const ref of uniqueRefs) {
            if (result[ref] === undefined) {
                throw new Error(`AWS Parameter Store: parameter "${ref}" not found`);
            }
        }
        return result;
    },
    async testConnection(config) {
        const client = createClient(config);
        try {
            await client.send(new DescribeParametersCommand({
                ...describeParametersInput(config),
                MaxResults: 1,
            }));
        }
        catch (error) {
            if (isAccessDeniedError(error)) {
                throw new Error("AWS Parameter Store: credentials were accepted, but connection testing and parameter discovery require ssm:DescribeParameters. Manual references can still work when ssm:GetParameters is allowed.");
            }
            throw error;
        }
    },
    async listSecretNames(config) {
        const client = createClient(config);
        const names = [];
        for await (const page of paginateDescribeParameters({ client, pageSize: 50 }, describeParametersInput(config))) {
            for (const parameter of page.Parameters ?? []) {
                if (parameter.Name) {
                    names.push(parameter.Name);
                }
                if (names.length >= 500) {
                    return names;
                }
            }
        }
        return names;
    },
};
