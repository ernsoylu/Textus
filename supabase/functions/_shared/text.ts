// Linear-time text helpers for untrusted markup (provider XML, EPUB content). They replace regexes such as
// /<[^>]+>/g and /<tag>([\s\S]*?)<\/tag>/, which backtrack super-linearly on hostile input.
// Pure and Edge-safe; re-exported by shared/text.ts for tests.

// Removes "<...>" runs; a "<" with no closing ">" is kept, like /<[^>]+>/g.
export function stripTags(html: string, replacement = ''): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = html.indexOf('<', i);
    const close = open < 0 ? -1 : html.indexOf('>', open + 1);
    if (close <= open + 1) return out + html.slice(i);
    out += html.slice(i, open) + replacement;
    i = close + 1;
  }
}

// Text between the first <tag ...> and its closing </tag>. `tag` is matched literally, so "dc:title"
// does not match "dc:titles". Returns undefined when either end is missing.
export function xmlElementText(xml: string, tag: string, ignoreCase = false): string | undefined {
  const haystack = ignoreCase ? xml.toLowerCase() : xml;
  const name = ignoreCase ? tag.toLowerCase() : tag;
  const open = `<${name}`;
  for (let from = 0;;) {
    const start = haystack.indexOf(open, from);
    if (start < 0) return undefined;
    const after = haystack[start + open.length];
    from = start + open.length;
    if (after !== '>' && after?.trim() !== '') continue;
    const gt = haystack.indexOf('>', from);
    const end = gt < 0 ? -1 : haystack.indexOf(`</${name}>`, gt + 1);
    return end < 0 ? undefined : xml.slice(gt + 1, end);
  }
}

// Strips any run of the given characters from the end of the string.
export function stripTrailing(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}
