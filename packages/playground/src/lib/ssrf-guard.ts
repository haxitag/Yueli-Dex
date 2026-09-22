/**
 * P1 (security): SSRF guard for server-side fetches of caller-supplied URLs.
 *
 * The playground probe endpoint fetches a user-provided provider endpoint
 * from the Next.js server. Without a guard this is a classic SSRF vector:
 * requests can reach localhost services, cloud metadata endpoints
 * (169.254.169.254), or internal RFC1918 addresses, and the availability /
 * timing of those probes leaks internal topology to the caller.
 *
 * Policy: only http(s) with a hostname that resolves to a public range.
 * Set DEX_ALLOW_PRIVATE_PROBE=1 to opt out for fully-trusted local installs
 * (the playground is a dev tool; some users legitimately probe localhost
 * providers).
 */

const ALLOW_PRIVATE =
  process.env.DEX_ALLOW_PRIVATE_PROBE === "1" ||
  process.env.DEX_ALLOW_PRIVATE_PROBE === "true";

const PRIVATE_V4_RANGES: Array<{ net: number; mask: number }> = [
  { net: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8
  { net: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12
  { net: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16
  { net: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8
  { net: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16 (link-local / metadata)
  { net: 0x64400000, mask: 0xffc00000 }, // 100.64.0.0/10 (CGNAT)
];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true; // malformed → treat as unsafe
  let num = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return true;
    num = (num << 8) | n;
  }
  // >>> 0 on BOTH sides of the comparison: `u & mask` yields a *signed*
  // int32, while the range constants (0xa9fe0000 etc.) are positive number
  // literals. Without normalizing the AND result, addresses ≥ 128.0.0.0
  // never match and 169.254.169.254-class targets slip through the guard.
  const u = num >>> 0;
  return PRIVATE_V4_RANGES.some(({ net, mask }) => ((u & mask) >>> 0) === net);
}

export type SsrfGuardResult =
  | { safe: true }
  | { safe: false; reason: string };

export function isSafeProbeEndpoint(rawEndpoint: string): SsrfGuardResult {
  if (ALLOW_PRIVATE) return { safe: true };

  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    return { safe: false, reason: `endpoint is not a valid URL: ${rawEndpoint}` };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: `endpoint scheme must be http(s), got "${url.protocol}"` };
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return { safe: false, reason: `endpoint host "${host}" resolves to a private scope and is not allowed` };
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateV4(host)) {
    return { safe: false, reason: `endpoint IP "${host}" is a private/loopback/link-local address and is not allowed` };
  }

  // IPv6 loopback / link-local / ULA — heuristics on the literal.
  if (host.includes(":")) {
    if (host === "[::1]" || host.startsWith("[fc") || host.startsWith("[fd") || host.startsWith("[fe80")) {
      return { safe: false, reason: `endpoint IPv6 "${host}" is loopback/private and is not allowed` };
    }
  }

  return { safe: true };
}
