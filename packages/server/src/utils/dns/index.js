import { cloudflareClient } from "./cloudflare";
import { infomaniakClient } from "./infomaniak";
import { ovhClient } from "./ovh";
import { porkbunClient } from "./porkbun";
import { route53Client } from "./route53";
const clients = {
    cloudflare: cloudflareClient,
    route53: route53Client,
    porkbun: porkbunClient,
    infomaniak: infomaniakClient,
    ovh: ovhClient,
};
export const getDnsClient = (providerType) => clients[providerType];
export * from "./types";
