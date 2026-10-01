// SSRF guard for user-supplied links (upload/from-url). The caller picks the host, so a host allowlist can't
// apply; instead only http(s) URLs on default ports whose addresses are all public are fetched.

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number);
}

export function isPublicIp(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) {
    const [a, b, c] = v4;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (!ip.includes(':')) return false;
  // IPv6: only global unicast (2000::/3). This also rejects ::1, ::ffff:<v4>, fc00::/7, fe80::/10 and multicast.
  const first = ip.startsWith('::') ? 0 : Number.parseInt(ip.split(':')[0], 16);
  return first >= 0x2000 && first <= 0x3fff && !/^2001:0?db8:/i.test(ip);
}

// Returns the parsed URL when its shape is fetchable, else null. Hostnames still need their DNS answers checked
// with isPublicIp; IP literals are checked here. URL parsing already normalizes forms like 0x7f.1 to 127.0.0.1.
export function parsePublicUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipv4Octets(host) || host.includes(':')) return isPublicIp(host) ? url : null;
  return host.includes('.') && !/\.(localhost|local|internal)$/i.test(host) ? url : null;
}

export function isIpLiteral(hostname: string): boolean {
  return !!ipv4Octets(hostname) || hostname.startsWith('[');
}
