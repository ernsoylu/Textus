import { describe, expect, it } from 'vitest';
import { inertBookHtml } from './inertBookHtml';

const META = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"/>`;

describe('inertBookHtml', () => {
  it('puts the policy first in <head>, before any script', () => {
    const html = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><HEAD profile="x"><script>alert(1)</script></HEAD><body/></html>';
    const out = inertBookHtml(html);
    expect(out).toContain(`<HEAD profile="x">${META}<script>`);
    expect(out.indexOf(META)).toBeLessThan(out.indexOf('<script>'));
  });

  it('adds a head when there is none, and does not mistake <header> for <head>', () => {
    expect(inertBookHtml('<html lang="en"><body><header>x</header></body></html>')).toBe(`<html lang="en"><head>${META}</head><body><header>x</header></body></html>`);
    expect(inertBookHtml('<p>fragment</p>')).toBe(`${META}<p>fragment</p>`);
  });

  it('keeps the page parseable as XHTML', () => {
    const out = inertBookHtml('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>ok</p></body></html>');
    const doc = new DOMParser().parseFromString(out, 'application/xhtml+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('meta')?.getAttribute('content')).toContain("script-src 'none'");
  });
});
