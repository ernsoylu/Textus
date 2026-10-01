import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { isPublicIp, parsePublicUrl, isIpLiteral } from './publicUrl.ts';

// The checked addresses are supplied to the socket lookup itself. HTTPS still checks
// the original URL hostname/SNI; no second DNS lookup, custom TLS or credential forwarding.
export async function fetchPublic(raw: string, signal: AbortSignal): Promise<Response | null> {
  let target = raw;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const url = parsePublicUrl(target);
    if (!url) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIpLiteral(url.hostname)
      ? [{ address: host, family: host.includes(':') ? 6 : 4 }]
      : await Promise.race([
        lookup(host, { all: true }),
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      ]);
    if (!addresses.length || !addresses.every(({ address }) => isPublicIp(address))) return null;
    const response = await new Promise<Response>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        agent: false, signal,
        headers: { Accept: 'application/pdf, application/epub+zip, */*;q=0.5', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      }, (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status: incoming.statusCode ?? 502, headers }));
      });
      req.on('error', reject);
      req.end();
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    target = new URL(location, url).href;
  }
  return null;
}
