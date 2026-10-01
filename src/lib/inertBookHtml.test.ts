import { expect, it } from 'vitest';
import { inertBookHtml } from './inertBookHtml';
it('places an active policy before hostile markup while retaining XHTML and CFI element positions', () => {
  const html = '<!-- <head> --><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title><script>alert(1)</script></head><body><p onclick="steal()">Evidence</p><iframe srcdoc="&lt;script&gt;steal()&lt;/script&gt;"></iframe><p>Second</p><a href="java&#x73;cript:steal()">Bad link</a><meta http-equiv="refresh" content="0;url=https://evil.test"/></body></html>';
  const doc = new DOMParser().parseFromString(inertBookHtml(html), 'application/xhtml+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.querySelector('head')?.firstElementChild?.getAttribute('content')).toContain("connect-src 'none'");
  expect(doc.querySelectorAll('script,iframe,[onclick],[srcdoc],[href^="javascript:"]')).toHaveLength(0);
  expect(doc.querySelector('body')?.children[2].textContent).toBe('Second');
  expect(doc.querySelectorAll('meta[http-equiv="refresh"]')).toHaveLength(0);
  expect(new DOMParser().parseFromString(inertBookHtml('<p>Fragment</p>'), 'application/xhtml+xml').querySelector('p')?.textContent).toBe('Fragment');
});
