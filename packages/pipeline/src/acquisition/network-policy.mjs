import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { AcquisitionError } from "./errors.mjs";

const REJECTED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

function ipv4ToInteger(address) {
  return address
    .split(".")
    .reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
}

function ipv4InCidr(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInteger(address) & mask) === (ipv4ToInteger(base) & mask);
}

export function isPublicNetworkAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    return !REJECTED_IPV4_RANGES.some(([base, prefix]) =>
      ipv4InCidr(address, base, prefix)
    );
  }
  if (family !== 6) {
    return false;
  }

  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return false;
  }

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPublicNetworkAddress(mappedIpv4) : true;
}

export function assertAllowedUrl(input, policy) {
  let url;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new AcquisitionError("URL_INVALID", "Source URL is invalid", { cause });
  }

  if (url.username || url.password) {
    throw new AcquisitionError("URL_CREDENTIALS", "Credentials are forbidden in source URLs");
  }
  if (!policy.allowedProtocols.includes(url.protocol)) {
    throw new AcquisitionError("PROTOCOL_BLOCKED", `Protocol ${url.protocol} is not allowed`);
  }
  if (!policy.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new AcquisitionError("HOST_BLOCKED", `Host ${url.hostname} is not allowlisted`);
  }

  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  if (!policy.allowedPorts.includes(port)) {
    throw new AcquisitionError("PORT_BLOCKED", `Port ${port} is not allowed`);
  }
  if (url.hash) {
    throw new AcquisitionError("URL_FRAGMENT", "Fragments are forbidden in source URLs");
  }
  return url;
}

export async function resolveAndAssertPublic(
  hostname,
  resolver = async (host) => defaultLookup(host, { all: true, verbatim: true })
) {
  let records;
  try {
    records = await resolver(hostname);
  } catch (cause) {
    throw new AcquisitionError("DNS_FAILED", `DNS resolution failed for ${hostname}`, {
      cause,
      retryable: true
    });
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new AcquisitionError("DNS_EMPTY", `DNS returned no addresses for ${hostname}`, {
      retryable: true
    });
  }
  for (const record of records) {
    if (!isPublicNetworkAddress(record.address)) {
      throw new AcquisitionError(
        "PRIVATE_ADDRESS_BLOCKED",
        `DNS for ${hostname} resolved to a non-public address`
      );
    }
  }
  return records;
}

export async function assertSafeTarget(input, policy, resolver) {
  const url = assertAllowedUrl(input, policy);
  if (isIP(url.hostname)) {
    if (!isPublicNetworkAddress(url.hostname)) {
      throw new AcquisitionError("PRIVATE_ADDRESS_BLOCKED", "Non-public IP literals are forbidden");
    }
    return { url, records: [{ address: url.hostname, family: isIP(url.hostname) }] };
  }
  return { url, records: await resolveAndAssertPublic(url.hostname, resolver) };
}
