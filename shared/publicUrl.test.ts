import { describe, expect, it } from 'vitest';
import { isPublicIp, parsePublicUrl } from './publicUrl';

describe('isPublicIp', () => {
  it('rejects private, loopback, link-local and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });
  it('accepts public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicIp(ip), ip).toBe(true);
  });
});

describe('parsePublicUrl', () => {
  it('accepts plain http(s) links', () => {
    expect(parsePublicUrl('https://arxiv.org/pdf/2101.00001')?.hostname).toBe('arxiv.org');
    expect(parsePublicUrl('http://8.8.8.8/a.pdf')).not.toBeNull();
  });
  it('rejects other schemes, credentials, ports and internal hosts', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://example.com/a.pdf', 'https://u:p@example.com/a.pdf', 'https://example.com:8443/a.pdf', 'http://localhost/a.pdf', 'http://kong/a.pdf', 'http://db.internal/a', 'http://0x7f.1/a', 'http://[::1]/a', 'http://169.254.169.254/latest', 'not a url']) {
      expect(parsePublicUrl(raw), raw).toBeNull();
    }
  });
});
