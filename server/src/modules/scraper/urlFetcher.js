import dns from "node:dns/promises";
import dnsCallback from "node:dns";
import net from "node:net";
import { Agent } from "undici";
import { ApiError } from "../../utils/http.js";
import { env } from "../../config/env.js";

// Fetching a user-supplied URL from the server is the classic SSRF sink: the
// request carries our network position, so "https://example.com" and
// "http://169.254.169.254/latest/meta-data/" look identical to the HTTP client
// but not to the cloud provider. Everything here exists to make the second one
// impossible.

const MAX_REDIRECTS = 3;

/**
 * Every rejection returns this one message. Distinguishing "blocked private
 * address" from "connection refused" would turn the endpoint into a port
 * scanner for anyone who can call it — the timing and error text alone would
 * map the internal network.
 */
function blockedUrl() {
  return new ApiError(
    400,
    "IMPORT_URL_BLOCKED",
    "That URL could not be fetched. Use a public job posting URL, or paste the description text instead.",
  );
}

// IPv4 ranges that must never be reachable. 169.254/16 is the important one:
// it's where AWS/GCP/Azure expose instance credentials.
const BLOCKED_V4 = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function ipv4ToInt(ip) {
  return (
    ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
  );
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  });
}

/**
 * Prefix matching rather than full IPv6 parsing — enough to cover loopback,
 * unique-local, link-local and multicast, which is the set that matters here.
 */
function isBlockedIpv6(ip) {
  const lower = ip.toLowerCase();

  // IPv4-mapped addresses must be judged by the v4 rules, and they arrive in
  // two spellings. `new URL()` normalises the dotted form to hex, so
  // "[::ffff:169.254.169.254]" reaches us as "::ffff:a9fe:a9fe" — matching only
  // the dotted form would leave the metadata endpoint reachable.
  const mappedDotted = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);

  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    const dotted = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
    return isBlockedIpv4(dotted);
  }

  if (lower === "::" || lower === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // ff00::/8 multicast
  return false;
}

function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // unparseable — refuse rather than guess
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

/**
 * DNS lookup that re-validates every address *at connect time*. This closes
 * the TOCTOU gap left by `assertPublicUrl`: that check resolves once, but the
 * socket resolves again, and a DNS-rebinding attacker with a short-TTL record
 * could answer the second lookup with a private IP. Injecting this lookup
 * into the agent means the address the socket actually dials is the address
 * that was validated — there is no second, unchecked resolution.
 */
function guardedLookup(hostname, options, callback) {
  dnsCallback.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    if (
      addresses.length === 0 ||
      addresses.some((entry) => isBlockedAddress(entry.address))
    ) {
      callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }));
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

/** Dispatcher whose sockets can only ever connect to public addresses. */
const publicOnlyAgent = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Validate one URL: scheme, hostname, and every address it resolves to.
 *
 * This is the fast first-line check (scheme, hostname denylist, IP literals).
 * The rebinding-proof enforcement is `guardedLookup` above, which runs again
 * inside the socket connect itself.
 */
async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blockedUrl();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw blockedUrl();
  if (isBlockedHostname(url.hostname)) throw blockedUrl();

  // Bracketed IPv6 literals arrive as "[::1]".
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literal)) {
    if (isBlockedAddress(literal)) throw blockedUrl();
    return url;
  }

  let records;
  try {
    records = await dns.lookup(literal, { all: true });
  } catch {
    throw blockedUrl();
  }

  // Reject if *any* record is private. A hostname with both a public and a
  // private A record must not be reachable just because we happened to read
  // the public one first.
  if (records.length === 0 || records.some((r) => isBlockedAddress(r.address))) {
    throw blockedUrl();
  }

  return url;
}

/** Read the body, aborting past the byte cap so a huge page can't exhaust memory. */
async function readCapped(response) {
  const max = env.IMPORT_MAX_HTML_BYTES;

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw blockedUrl();

  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw blockedUrl();
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a job posting page with SSRF protection.
 *
 * Redirects are followed **manually** and every hop is re-validated. With
 * `redirect: "follow"` the whole address check above would be decorative: an
 * allowed public host can 302 straight to 169.254.169.254 and the runtime would
 * follow it without asking us again.
 */
export async function fetchJobPage(rawUrl) {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current);

    let response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        dispatcher: publicOnlyAgent,
        signal: AbortSignal.timeout(env.IMPORT_FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "JobCopilotBot/1.0 (+job posting import)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      // Timeout, DNS failure, TLS failure, connection refused — all collapse to
      // the same message so none of them leak network topology.
      throw blockedUrl();
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw blockedUrl();
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) throw blockedUrl();

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) throw blockedUrl();

    return { html: await readCapped(response), finalUrl: url.toString() };
  }

  throw blockedUrl(); // redirect limit exceeded
}
