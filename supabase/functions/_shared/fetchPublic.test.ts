import { fetchPublic } from './fetchPublic.ts';
Deno.test('URL fetch cannot reach loopback, mapped IPv6, private DNS or redirect-shaped URLs', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://192.168.1.104/', 'http://2130706433/', 'http://user:pass@example.com/', 'http://192.0.2.1/', 'http://[2002:7f00:1::]/']) {
    if (await fetchPublic(url, AbortSignal.timeout(1000)) !== null) throw new Error(`unsafe destination accepted: ${url}`);
  }
});
