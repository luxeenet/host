/**
 * Cloudflare Published IP Ranges and Trusted Proxy CIDRs
 *
 * Source:
 * - IPv4: https://www.cloudflare.com/ips-v4
 * - IPv6: https://www.cloudflare.com/ips-v6
 *
 * Used for:
 * 1. Traefik forwardedHeaders.trustedIPs configuration
 * 2. Origin firewall lockdown (UFW / iptables / ip6tables)
 * 3. Domain ingress analysis and client IP attribution
 */

export const CLOUDFLARE_IPV4_CIDRS: readonly string[] = [
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
] as const;

export const CLOUDFLARE_IPV6_CIDRS: readonly string[] = [
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
] as const;

export const LOCAL_AND_PRIVATE_CIDRS: readonly string[] = [
	"127.0.0.1/32",
	"::1/128",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
] as const;

export const ALL_CLOUDFLARE_CIDRS: readonly string[] = [
	...CLOUDFLARE_IPV4_CIDRS,
	...CLOUDFLARE_IPV6_CIDRS,
] as const;

/**
 * Trusted IPs for Traefik forwardedHeaders on web (80) and websecure (443) entrypoints.
 * Includes all Cloudflare IPv4 & IPv6 ranges and private container/loopback ranges.
 */
export const TRAEFIK_DEFAULT_TRUSTED_IPS: readonly string[] = [
	...ALL_CLOUDFLARE_CIDRS,
	...LOCAL_AND_PRIVATE_CIDRS,
] as const;
