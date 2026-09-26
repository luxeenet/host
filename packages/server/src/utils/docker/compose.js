import crypto from "node:crypto";
import { findComposeById } from "@dokploy/server/services/compose";
import { parse, stringify } from "yaml";
import { addSuffixToAllConfigs } from "./compose/configs";
import { addSuffixToAllNetworks } from "./compose/network";
import { addSuffixToAllSecrets } from "./compose/secrets";
import { addSuffixToAllServiceNames } from "./compose/service";
import { addSuffixToAllVolumes } from "./compose/volume";
export const generateRandomHash = () => {
    return crypto.randomBytes(4).toString("hex");
};
export const randomizeComposeFile = async (composeId, suffix) => {
    const compose = await findComposeById(composeId);
    const composeFile = compose.composeFile;
    const composeData = parse(composeFile, {
        maxAliasCount: 10000,
    });
    const randomSuffix = suffix || generateRandomHash();
    const newComposeFile = addSuffixToAllProperties(composeData, randomSuffix);
    return stringify(newComposeFile);
};
export const randomizeSpecificationFile = (composeSpec, suffix) => {
    if (!suffix) {
        return composeSpec;
    }
    const newComposeFile = addSuffixToAllProperties(composeSpec, suffix);
    return newComposeFile;
};
export const addSuffixToAllProperties = (composeData, suffix) => {
    let updatedComposeData = { ...composeData };
    updatedComposeData = addSuffixToAllServiceNames(updatedComposeData, suffix);
    updatedComposeData = addSuffixToAllVolumes(updatedComposeData, suffix);
    updatedComposeData = addSuffixToAllNetworks(updatedComposeData, suffix);
    updatedComposeData = addSuffixToAllConfigs(updatedComposeData, suffix);
    updatedComposeData = addSuffixToAllSecrets(updatedComposeData, suffix);
    return updatedComposeData;
};
