import ipaddr from "ipaddr.js";

export const isBlockedFetchHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (!ipaddr.isValid(normalized)) {
    return false;
  }

  const address = ipaddr.parse(normalized);

  if (address.kind() === "ipv4") {
    return address.range() !== "unicast";
  }

  const ipv6Address = address as ipaddr.IPv6;

  if (ipv6Address.isIPv4MappedAddress()) {
    return true;
  }

  return ipv6Address.range() !== "unicast";
};

export const isHttpFetchUrlAllowed = (sourceUrl: string) => {
  const url = new URL(sourceUrl);

  return (
    (url.protocol === "http:" || url.protocol === "https:") && !isBlockedFetchHostname(url.hostname)
  );
};
