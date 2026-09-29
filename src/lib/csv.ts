// Minimal RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim())) rows.push(row);
    row = [];
  };
  const src = text.replace(/^\u{FEFF}/u, '').replaceAll('\r\n', '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') endField();
    else if (c === '\n' || c === '\r') endRow();
    else field += c;
  }
  endRow();
  return rows;
}
