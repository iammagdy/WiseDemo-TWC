import { lookup } from "node:dns/promises";

export type PublicHostResolver = (hostname: string) => Promise<string[]>;

const privateIpv4Ranges = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

function isPrivateIpv4(address: string): boolean {
  return privateIpv4Ranges.some((range) => range.test(address));
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export function isPublicIpAddress(address: string): boolean {
  return !isPrivateIpv4(address) && !isPrivateIpv6(address);
}

export function parsePublicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid public HTTP(S) URL is required.");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("Only HTTP(S) URLs may be analyzed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials cannot be analyzed.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local, metadata, and private hostnames cannot be analyzed.");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error("Private and loopback IP addresses cannot be analyzed.");
    }
  }
  return url;
}

async function resolvePublicHost(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

export async function assertPublicHttpUrl(
  value: string,
  resolver: PublicHostResolver = resolvePublicHost,
): Promise<URL> {
  const url = parsePublicHttpUrl(value);
  const addresses = await resolver(url.hostname);
  if (!addresses.length || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new Error("The URL resolves to a non-public network address.");
  }
  return url;
}
