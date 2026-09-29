// Citation export (FR-RES-1, §8.4): BibTeX, RIS and CSL-JSON from one normalized source.
// Pure and Edge-safe (no imports) so the Deno function and Vitest (via shared/citations.ts) run
// the same code. Bylines follow FR-CONTRIB-4: authors, else editors, else compilers, else
// translators. Container data (chapter → edited volume, article → issue) is read from the
// container record and never copied onto the chapter (§6.3).

export interface CitationName {
  family?: string;
  given?: string;
  particle?: string;
  suffix?: string;
  literal?: string; // organizations
}

export interface CitationContainer {
  title?: string;
  editors: CitationName[];
  publisher?: string;
  date?: string;
}

export interface CitationSource {
  id: string;
  workType: string;
  recordType: string;
  title: string;
  subtitle?: string;
  authors: CitationName[];
  editors: CitationName[];
  translators: CitationName[];
  date?: string; // ISO YYYY, YYYY-MM or YYYY-MM-DD
  publisher?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  abstract?: string;
  version?: string; // 'preprint' | 'published' (FR-RES-2)
  identifiers: { scheme: string; value: string }[];
  container?: CitationContainer;
}

// ---------- Building a source from a database row ----------

export interface CreditRow {
  role: string;
  position: number;
  contributors: { kind: string; display_name: string; family_name: string | null; given_names: string | null; particle: string | null; suffix: string | null } | null;
}
export interface RecordRowForCitation {
  id: string;
  title: string | null;
  record_type: string;
  publication_date: string | null;
  publication_date_precision: string | null;
  publisher: string | null;
  edition: string | null;
  volume: string | null;
  issue_number: string | null;
  pages: string | null;
  metadata: unknown;
  works: { title: string; subtitle: string | null; abstract: string | null; language: string | null; work_type: string } | null;
  identifiers: { scheme: string; normalized_value: string }[];
  record_contributors: CreditRow[];
  container: {
    title: string | null;
    publisher: string | null;
    publication_date: string | null;
    publication_date_precision: string | null;
    works: { title: string } | null;
    record_contributors: CreditRow[];
  } | null;
}

function toName(c: NonNullable<CreditRow['contributors']>): CitationName {
  if (c.kind === 'organization') return { literal: c.display_name };
  return { family: c.family_name ?? c.display_name, given: c.given_names ?? undefined, particle: c.particle ?? undefined, suffix: c.suffix ?? undefined };
}

const namesFor = (credits: CreditRow[], role: string): CitationName[] =>
  credits
    .filter((c) => c.role === role && c.contributors)
    .sort((a, b) => a.position - b.position)
    .map((c) => toName(c.contributors!));

function isoDate(date: string | null, precision: string | null): string | undefined {
  if (!date) return undefined;
  const cut = precision === 'year' ? 4 : precision === 'month' ? 7 : 10;
  return date.slice(0, cut);
}

export function buildSource(row: RecordRowForCitation): CitationSource {
  const meta = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
  const credits = row.record_contributors;
  // FR-CONTRIB-4 fallback: authors, else editors (emitted as `editor`), else compilers, else translators.
  const ownEditors = row.record_type === 'edition' || row.record_type === 'issue' ? namesFor(credits, 'editor') : [];
  const authors = namesFor(credits, 'author');
  const fallback = authors.length || ownEditors.length ? [] : [namesFor(credits, 'compiler'), namesFor(credits, 'translator')].find((l) => l.length) ?? [];
  const container = row.container
    ? {
        title: row.container.title ?? row.container.works?.title,
        editors: namesFor(row.container.record_contributors, 'editor'),
        publisher: row.container.publisher ?? undefined,
        date: isoDate(row.container.publication_date, row.container.publication_date_precision),
      }
    : typeof meta.container_title === 'string'
      ? { title: meta.container_title, editors: [] }
      : undefined;
  return {
    id: row.id,
    workType: row.works?.work_type ?? 'other',
    recordType: row.record_type,
    title: row.title ?? row.works?.title ?? 'Untitled',
    subtitle: row.works?.subtitle ?? undefined,
    authors: authors.length ? authors : fallback,
    editors: ownEditors,
    translators: namesFor(credits, 'translator'),
    date: isoDate(row.publication_date, row.publication_date_precision),
    publisher: row.publisher ?? undefined,
    edition: row.edition ?? undefined,
    volume: row.volume ?? undefined,
    issue: row.issue_number ?? undefined,
    pages: row.pages ?? undefined,
    language: row.works?.language ?? undefined,
    abstract: row.works?.abstract ?? undefined,
    version: typeof meta.version === 'string' ? meta.version : undefined,
    identifiers: row.identifiers.map((i) => ({ scheme: i.scheme, value: i.normalized_value })),
    container,
  };
}

// ---------- Shared helpers ----------

const idOf = (s: CitationSource, scheme: string) => s.identifiers.find((i) => i.scheme === scheme)?.value;
const fullTitle = (s: CitationSource) => (s.subtitle ? `${s.title}: ${s.subtitle}` : s.title);
const yearOf = (d?: string) => d?.slice(0, 4);
const monthOf = (d?: string) => (d && d.length >= 7 ? Number(d.slice(5, 7)) : undefined);
// For a chapter or article, `editor` in CSL/BibTeX/RIS means the container's editors; they are
// read from the container record, never copied onto the chapter (§6.3).
const editorsOf = (s: CitationSource) => (s.editors.length ? s.editors : (s.container?.editors ?? []));

// ---------- CSL-JSON ----------

const CSL_TYPE: Record<string, string> = { book: 'book', article: 'article-journal', chapter: 'chapter', serial: 'periodical', thesis: 'thesis', report: 'report' };

function cslName(n: CitationName) {
  if (n.literal) return { literal: n.literal };
  return { family: n.family, given: n.given, 'non-dropping-particle': n.particle, suffix: n.suffix };
}

function cslDate(d?: string) {
  if (!d) return undefined;
  return { 'date-parts': [d.split('-').map(Number)] };
}

export function toCslJson(sources: CitationSource[]): string {
  const items = sources.map((s) => {
    const type = s.recordType === 'issue' ? 'periodical' : (CSL_TYPE[s.workType] ?? 'document');
    const item: Record<string, unknown> = {
      id: s.id,
      type,
      title: fullTitle(s),
      author: s.authors.map(cslName),
      editor: editorsOf(s).map(cslName),
      translator: s.translators.map(cslName),
      issued: cslDate(s.date),
      publisher: s.publisher ?? s.container?.publisher,
      edition: s.edition,
      volume: s.volume,
      issue: s.issue,
      page: s.pages,
      language: s.language,
      abstract: s.abstract,
      DOI: idOf(s, 'doi'),
      ISBN: idOf(s, 'isbn'),
      ISSN: idOf(s, 'issn'),
      PMID: idOf(s, 'pmid'),
      'container-title': s.container?.title,
    };
    const arxiv = idOf(s, 'arxiv');
    if (arxiv) item.number = `arXiv:${arxiv}`;
    if (s.version === 'preprint') item.genre = 'preprint';
    // JSON.stringify drops undefined values; empty name lists are dropped explicitly.
    for (const key of ['author', 'editor', 'translator']) if (Array.isArray(item[key]) && !(item[key] as unknown[]).length) delete item[key];
    return item;
  });
  return JSON.stringify(items, null, 2);
}

// ---------- BibTeX ----------

const BIB_TYPE: Record<string, string> = { book: 'book', article: 'article', chapter: 'incollection', thesis: 'phdthesis', report: 'techreport', serial: 'misc' };

// Escapes what BibTeX treats specially. Braces are escaped too, so a title cannot break the entry.
export function bibEscape(text: string): string {
  return text.replace(/[\\{}]/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`)).replace(/[&%$#_]/g, (c) => `\\${c}`);
}

function bibName(n: CitationName): string {
  if (n.literal) return `{${bibEscape(n.literal)}}`;
  const family = [n.particle, n.family].filter(Boolean).join(' ');
  return [bibEscape(family), n.suffix ? bibEscape(n.suffix) : '', n.given ? bibEscape(n.given) : ''].filter(Boolean).join(', ');
}

function bibKey(s: CitationSource, used: Set<string>): string {
  const lead = s.authors[0] ?? editorsOf(s)[0];
  const base = (lead?.family ?? lead?.literal ?? 'anon').normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'anon';
  const word = s.title.normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).find((w) => w.length > 3)?.toLowerCase() ?? '';
  let key = `${base}${yearOf(s.date) ?? ''}${word}`;
  for (let n = 2; used.has(key); n++) key = `${base}${yearOf(s.date) ?? ''}${word}${n}`;
  used.add(key);
  return key;
}

// Already escaped (names) or verbatim identifiers and numbers.
const RAW_BIB_FIELDS = new Set(['author', 'editor', 'doi', 'isbn', 'issn', 'eprint', 'pmid', 'month', 'year']);

export function toBibtex(sources: CitationSource[]): string {
  const used = new Set<string>();
  return sources
    .map((s) => {
      const type = s.recordType === 'issue' ? 'misc' : (BIB_TYPE[s.workType] ?? 'misc');
      const fields: [string, string | undefined][] = [
        ['title', fullTitle(s)],
        ['author', s.authors.length ? s.authors.map(bibName).join(' and ') : undefined],
        ['editor', editorsOf(s).length ? editorsOf(s).map(bibName).join(' and ') : undefined],
        [type === 'article' ? 'journal' : 'booktitle', s.container?.title],
        ['year', yearOf(s.date)],
        ['month', monthOf(s.date)?.toString()],
        ['publisher', s.publisher ?? s.container?.publisher],
        ['edition', s.edition],
        ['volume', s.volume],
        ['number', s.issue],
        ['pages', s.pages?.replace(/\s*[-–—]+\s*/, '--')],
        ['doi', idOf(s, 'doi')],
        ['isbn', idOf(s, 'isbn')],
        ['issn', idOf(s, 'issn')],
        ['eprint', idOf(s, 'arxiv')],
        ['pmid', idOf(s, 'pmid')],
        ['abstract', s.abstract],
      ];
      // container-only fields (journal/booktitle) belong to article/incollection entries
      const body = fields
        .filter(([k, v]) => v && !((k === 'booktitle' || k === 'journal') && type !== 'incollection' && type !== 'article'))
        .map(([k, v]) => `  ${k} = {${RAW_BIB_FIELDS.has(k) ? v : bibEscape(v!)}}`)
        .join(',\n');
      return `@${type}{${bibKey(s, used)},\n${body}\n}`;
    })
    .join('\n\n') + '\n';
}

// ---------- RIS ----------

const RIS_TYPE: Record<string, string> = { book: 'BOOK', article: 'JOUR', chapter: 'CHAP', thesis: 'THES', report: 'RPRT', serial: 'GEN' };

function risName(n: CitationName): string {
  if (n.literal) return n.literal;
  const family = [n.particle, n.family].filter(Boolean).join(' ');
  return [family, n.given, n.suffix].filter(Boolean).join(', ');
}

export function toRis(sources: CitationSource[]): string {
  return sources
    .map((s) => {
      const [startPage, ...rest] = (s.pages ?? '').split(/\s*[-–—]+\s*/);
      const lines: [string, string | undefined][] = [
        ['TY', s.recordType === 'issue' ? 'GEN' : (RIS_TYPE[s.workType] ?? 'GEN')],
        ['TI', fullTitle(s)],
        ...s.authors.map((n): [string, string] => ['AU', risName(n)]),
        ...editorsOf(s).map((n): [string, string] => ['ED', risName(n)]),
        ...s.translators.map((n): [string, string] => ['A4', risName(n)]),
        ['T2', s.container?.title],
        ['PY', yearOf(s.date)],
        ['DA', s.date?.replaceAll('-', '/')],
        ['PB', s.publisher ?? s.container?.publisher],
        ['ET', s.edition],
        ['VL', s.volume],
        ['IS', s.issue],
        ['SP', startPage || undefined],
        ['EP', rest.length ? rest.join('-') : undefined],
        ['DO', idOf(s, 'doi')],
        ['SN', idOf(s, 'isbn') ?? idOf(s, 'issn')],
        ['AB', s.abstract],
        ['LA', s.language],
        ['ID', s.id],
      ];
      return lines.filter(([, v]) => v).map(([k, v]) => `${k}  - ${v!.replace(/\r?\n/g, ' ')}`).concat('ER  - ').join('\n');
    })
    .join('\n\n') + '\n';
}

export type ExportFormat = 'bibtex' | 'ris' | 'csl-json';
export const EXPORT_FORMATS: Record<ExportFormat, { render: (s: CitationSource[]) => string; extension: string; mime: string }> = {
  bibtex: { render: toBibtex, extension: 'bib', mime: 'application/x-bibtex' },
  ris: { render: toRis, extension: 'ris', mime: 'application/x-research-info-systems' },
  'csl-json': { render: toCslJson, extension: 'json', mime: 'application/vnd.citationstyles.csl+json' },
};
