// Parse inertly: a fake <head> inside a comment/attribute must never precede the policy.
const BOOK_POLICY = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function inertBookHtml(html: string): string {
  const parser = new DOMParser();
  const xml = parser.parseFromString(html, 'application/xhtml+xml');
  const isSvg = !xml.querySelector('parsererror') && xml.documentElement.localName === 'svg';
  const doc = !xml.querySelector('parsererror') && xml.documentElement.localName === 'html' && xml.documentElement.namespaceURI === 'http://www.w3.org/1999/xhtml' ? xml : parser.parseFromString(html, 'text/html');
  if (isSvg) doc.body.replaceChildren(doc.importNode(xml.documentElement, true));
  const hasHead = [...doc.documentElement.children].some((e) => e.localName === 'head');
  for (const element of doc.querySelectorAll('*')) {
    // Preserve element positions for existing CFIs while neutralizing active containers.
    if (['script','iframe','frame','object','embed','base','form','meta','animate','animatemotion','animatetransform','set','discard'].includes(element.localName.toLowerCase()) || (!hasHead && ['style', 'link'].includes(element.localName.toLowerCase()))) {
      const replacement = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
      replacement.setAttribute('hidden', '');
      if (element.localName.toLowerCase() === 'form') { replacement.removeAttribute('hidden'); replacement.append(...element.childNodes); }
      element.replaceWith(replacement);
      continue;
    }
    for (const attr of [...element.attributes]) {
      if (attr.name === 'xmlns' && !attr.namespaceURI) { element.removeAttributeNode(attr); continue; }
      if (/^on/i.test(attr.localName) || ['srcdoc','action','formaction','target','ping','srcset'].includes(attr.localName.toLowerCase()) || (/^(?:href|src)$/i.test(attr.localName) && /^\s*(?:javascript|vbscript):/i.test(Array.from(attr.value).filter((char) => char.charCodeAt(0) > 32).join('')))) element.removeAttributeNode(attr);
      // Foliate has already rewritten packaged resources to blobs. Never fetch tracking URLs.
      if (['src', 'poster', 'background'].includes(attr.localName.toLowerCase()) || (attr.localName.toLowerCase() === 'href' && element.localName.toLowerCase() !== 'a')) {
        if (!/^(?:blob:|data:|#)/i.test(attr.value.trim())) element.removeAttributeNode(attr);
      }
    }
  }
  const policy = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy'); policy.setAttribute('content', BOOK_POLICY);
  const head = [...doc.documentElement.children].find((e) => e.localName === 'head');
  if (head) head.prepend(policy);
  else {
    // Keep the original body CFI when a headless XHTML file starts its body at /2.
    const newHead = doc.createElementNS('http://www.w3.org/1999/xhtml', 'head'); newHead.append(policy); doc.documentElement.append(newHead);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
