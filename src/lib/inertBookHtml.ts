// Defense in depth for books (NFR-SEC): foliate-js must allow scripts in its book iframes (a WebKit event bug),
// and relies on the page's CSP to stop a book's own scripts. The server sends that CSP
// (deploy/security-headers.conf); this also puts one first in every book page, so a book stays inert where no
// header is sent (the dev server, a proxy that drops headers).
const BOOK_CSP = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"/>`;

export function inertBookHtml(html: string): string {
  if (/<head[\s>]/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + BOOK_CSP);
  // No <head>: open one right after <html …> (browsers merge it into the head they create).
  if (/<html[\s>]/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (tag) => `${tag}<head>${BOOK_CSP}</head>`);
  return BOOK_CSP + html;
}
