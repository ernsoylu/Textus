import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Agent, request } from 'undici';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { isPublicIp, parsePublicUrl, isIpLiteral } from './publicUrl.ts';

// Connect to the validated literal IP. TLS verifies the original hostname/SNI.
// Deno 2.1's node:http does not implement lookup overrides; never fall back to unchecked fetch.
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
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    const dispatcher = new Agent({ connect: (_options, callback) => {
      const secure = url.protocol === 'https:';
      const socket = secure ? tlsConnect({ host: address.address, port: 443, servername: host, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] }) : tcpConnect({ host: address.address, port: 80 });
      const fail = (error: Error) => callback(error, null);
      socket.once('error', fail);
      socket.once(secure ? 'secureConnect' : 'connect', () => { socket.removeListener('error', fail); callback(null, socket); });
      socket.setTimeout(10_000, () => socket.destroy(new Error('Public connection timed out')));
    } });
    let response: Response;
    try {
      const incoming = await request(url, { dispatcher, signal, maxRedirections: 0, headers: { Accept: 'application/pdf, application/epub+zip, */*;q=0.5', 'Accept-Encoding': 'identity' } });
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      incoming.body.once('close', () => { void dispatcher.destroy().catch(() => {}); });
      response = new Response(Readable.toWeb(incoming.body) as ReadableStream<Uint8Array>, { status: incoming.statusCode, headers });
    } catch (error) { await dispatcher.destroy(); throw error; }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    target = new URL(location, url).href;
  }
  return null;
}
