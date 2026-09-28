// shared/identifier.ts — validation/normalization for the `identifiers` table (§6.2).
// Dependency-free so both the SPA and Edge Functions can import it (§12). CLAUDE.md
// invariant 2: identifiers are validated and normalized here, never stored as JSONB.

export type IdentifierScheme = 'isbn' | 'doi' | 'issn' | 'arxiv' | 'pmid';

export interface IdentifierOk {
  ok: true;
  scheme: IdentifierScheme;
  normalized: string;
  original: string;
  /** arXiv only: the version suffix (e.g. 2 for "v2"), stored separately per §6.2. */
  arxivVersion?: number;
}

export interface IdentifierError {
  ok: false;
  reason: 'invalid_format' | 'invalid_check_digit';
}

export type IdentifierResult = IdentifierOk | IdentifierError;

function digitValue(ch: string): number | null {
  if (ch === 'X' || ch === 'x') return 10;
  return /^\d$/.test(ch) ? Number(ch) : null;
}

function isbn10CheckDigitValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = digitValue(digits[i]);
    if (v === null || (v === 10 && i !== 9)) return false; // 'X' only allowed as the check digit
    sum += (10 - i) * v;
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function isbn10ToIsbn13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return first12 + isbn13CheckDigit(first12);
}

function parseIsbn(raw: string): IdentifierResult {
  const cleaned = raw
    .trim()
    .replace(/^isbn(-1[03])?:?\s*/i, '')
    .replace(/[-\s]/g, '')
    .toUpperCase();

  if (cleaned.length === 10) {
    if (!/^\d{9}[\dX]$/.test(cleaned)) return { ok: false, reason: 'invalid_format' };
    if (!isbn10CheckDigitValid(cleaned)) return { ok: false, reason: 'invalid_check_digit' };
    return { ok: true, scheme: 'isbn', normalized: isbn10ToIsbn13(cleaned), original: raw };
  }
  if (cleaned.length === 13) {
    if (!/^\d{13}$/.test(cleaned)) return { ok: false, reason: 'invalid_format' };
    if (isbn13CheckDigit(cleaned.slice(0, 12)) !== Number(cleaned[12])) {
      return { ok: false, reason: 'invalid_check_digit' };
    }
    return { ok: true, scheme: 'isbn', normalized: cleaned, original: raw };
  }
  return { ok: false, reason: 'invalid_format' };
}

function parseDoi(raw: string): IdentifierResult {
  const stripped = raw
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();
  if (!/^10\.\d{4,9}\/\S+$/.test(stripped)) return { ok: false, reason: 'invalid_format' };
  return { ok: true, scheme: 'doi', normalized: stripped.toLowerCase(), original: raw };
}

function issnCheckDigit(first7: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (8 - i) * Number(first7[i]);
  const remainder = sum % 11;
  return remainder === 0 ? 0 : 11 - remainder;
}

function parseIssn(raw: string): IdentifierResult {
  const cleaned = raw.trim().replace(/[-\s]/g, '').toUpperCase();
  if (!/^\d{7}[\dX]$/.test(cleaned)) return { ok: false, reason: 'invalid_format' };
  const expected = issnCheckDigit(cleaned.slice(0, 7));
  const actual = digitValue(cleaned[7])!;
  if (expected !== actual) return { ok: false, reason: 'invalid_check_digit' };
  const checkChar = expected === 10 ? 'X' : String(expected);
  return { ok: true, scheme: 'issn', normalized: `${cleaned.slice(0, 4)}-${cleaned.slice(4, 7)}${checkChar}`, original: raw };
}

function parseArxiv(raw: string): IdentifierResult {
  const stripped = raw
    .trim()
    .replace(/^arxiv:\s*/i, '')
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .trim();
  const match = /^(\d{4}\.\d{4,5})(?:v(\d+))?$/.exec(stripped);
  if (!match) return { ok: false, reason: 'invalid_format' };
  return {
    ok: true,
    scheme: 'arxiv',
    normalized: match[1],
    original: raw,
    ...(match[2] ? { arxivVersion: Number(match[2]) } : {}),
  };
}

function parsePmid(raw: string): IdentifierResult {
  const stripped = raw.trim().replace(/^pmid:?\s*/i, '').trim();
  if (!/^\d{1,9}$/.test(stripped)) return { ok: false, reason: 'invalid_format' };
  return { ok: true, scheme: 'pmid', normalized: String(Number(stripped)), original: raw };
}

const PARSERS: Record<IdentifierScheme, (raw: string) => IdentifierResult> = {
  isbn: parseIsbn,
  doi: parseDoi,
  issn: parseIssn,
  arxiv: parseArxiv,
  pmid: parsePmid,
};

export function parseIdentifier(scheme: IdentifierScheme, raw: string): IdentifierResult {
  return PARSERS[scheme](raw);
}
