import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) test(`hostile book documents remain inert without deployment headers (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const tracking: string[] = [];
  await page.route('**/*evil.test/**', (route) => { tracking.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // Exercise the exact reader transform on real browser documents, with no server CSP.
    const path = '/src/lib/inertBookHtml.ts';
    const { inertBookHtml } = await import(/* @vite-ignore */ path);
    const fixtures = [
      '<!-- <head> --><html xmlns="http://www.w3.org/1999/xhtml"><head><script>parent.document.body.dataset.exploited="yes"</script><style>body{background:url(https://evil.test/style)}</style></head><body><p id="evidence">Evidence</p><img src="https://evil.test/image" onerror="parent.document.body.dataset.exploited=\'yes\'"/><iframe src="https://evil.test/frame"/><form action="https://evil.test/form"><input name="secret"/></form><meta http-equiv="refresh" content="0;url=https://evil.test/navigation"/></body></html>',
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="evidence">Evidence</p><style>@import "https://evil.test/css";</style><img src="https://evil.test/headless"/></body></html>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.document.body.dataset.exploited="yes"</script><image href="https://evil.test/svg"/><a href="javascript:alert(1)"><set attributeName="href" to="javascript:alert(1)"/><text id="evidence">Evidence</text></a></svg>',
    ];
    const evidence: string[] = [];
    for (const source of fixtures) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
      const url = URL.createObjectURL(new Blob([inertBookHtml(source)], { type: 'application/xhtml+xml' }));
      await new Promise<void>((resolve) => { frame.onload = () => resolve(); frame.src = url; document.body.append(frame); });
      evidence.push(frame.contentDocument?.querySelector('#evidence')?.textContent ?? 'missing');
      frame.remove(); URL.revokeObjectURL(url);
    }
    return { exploited: document.body.dataset.exploited, evidence };
  });
  expect(result.exploited).toBeUndefined();
  expect(result.evidence).toEqual(['Evidence', 'Evidence', 'Evidence']);
  expect(tracking).toEqual([]);
});
