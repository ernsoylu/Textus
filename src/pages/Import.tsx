import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useImport } from '@/hooks/useImport';
import { autoMapping, FIELD_LABELS, IMPORT_FIELDS, readCsvTable, type ColumnMapping, type CsvTable } from '@/lib/importRows';
import { Button } from '@/components/ui/button';

const STATUS_COLOR = { imported: 'text-green', skipped: 'text-yellow', failed: 'text-red' } as const;
const SELECT = 'rounded-8 border border-muted bg-dim p-3 text-body text-fg';

const HELP = {
  doi: 'One DOI per line. Each is looked up (Crossref) and imported only if the provider returns real data.',
  csv: 'A CSV with a header row. You match its columns to Textus fields next; names are parsed into editable credits.',
} as const;

type Step = 'input' | 'mapping' | 'review';

// FR-RES-3: bulk import from CSV or a list of DOIs — Figma "csv map" (Match the columns) and
// "import results" (Import review). Nothing is written until the review is confirmed.
export function Import() {
  const [mode, setMode] = useState<'doi' | 'csv'>('doi');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const { plan, results, analyzing, running, error, analyzeCsv, analyzeDois, execute, reset } = useImport();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  }

  async function next() {
    if (mode === 'doi') {
      await analyzeDois(text);
      setStep('review');
      return;
    }
    const parsed = readCsvTable(text);
    setTable(parsed);
    setMapping(autoMapping(parsed.header));
    setStep('mapping');
  }

  async function review() {
    if (!table || !mapping) return;
    await analyzeCsv(table, mapping);
    setStep('review');
  }

  function back() {
    reset();
    setStep(mode === 'csv' && table ? 'mapping' : 'input');
  }

  const done = results.length > 0 && !running;

  if (step === 'mapping' && table && mapping) {
    return (
      <div className="flex max-w-[720px] flex-col gap-4">
        <p className="font-serif text-title text-fg">Match the columns.</p>
        <p className="text-body text-muted">{fileName || 'Pasted CSV'} · {table.body.length} {table.body.length === 1 ? 'row' : 'rows'} · Preview before import</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {IMPORT_FIELDS.map((field) => (
            <label key={field} className="flex flex-col gap-2 text-small text-fg">
              {field} →
              <select
                aria-label={`Column for ${field}`}
                className={SELECT}
                value={mapping[field]}
                onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
              >
                <option value={-1}>Ignore column</option>
                {table.header.map((h, i) => <option key={`${h}:${i}`} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
              <span className="text-muted">{FIELD_LABELS[field]}</span>
            </label>
          ))}
        </div>
        <p className="rounded-8 bg-green-bg p-3 text-small text-fg">Names are parsed into editable credits. Invalid identifiers and existing records are flagged for review.</p>
        {mapping.title === -1 && <p className="text-small text-yellow">Choose the column that holds each work’s title.</p>}
        {error && <p className="text-small text-red" role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button isLoading={analyzing} disabled={mapping.title === -1} onClick={review}>Review {table.body.length} {table.body.length === 1 ? 'row' : 'rows'}</Button>
          <Button variant="secondary" onClick={() => setStep('input')}>Back</Button>
        </div>
      </div>
    );
  }

  if (step === 'review' && plan) {
    const problems = plan.invalid.length;
    return (
      <div className="flex max-w-[720px] flex-col gap-4">
        <p className="text-small text-green">{done ? 'IMPORT COMPLETE' : 'REVIEW'}</p>
        <p className="font-serif text-title text-fg">Import review.</p>
        <p className="text-body text-muted">{plan.ready.length} ready · {plan.duplicates.length} {plan.duplicates.length === 1 ? 'duplicate' : 'duplicates'} · {problems} needs attention</p>

        <section className="flex flex-col gap-1 rounded-8 bg-raised p-4">
          <p className="text-label text-fg">{plan.ready.length} {plan.ready.length === 1 ? 'record' : 'records'} ready</p>
          <ul className="flex flex-col gap-1">
            {plan.ready.slice(0, 30).map((r) => <li key={r.label} className="text-small text-muted">{r.label}{r.detail ? ` — ${r.detail}` : ''}</li>)}
            {plan.ready.length > 30 && <li className="text-small text-muted">…and {plan.ready.length - 30} more</li>}
          </ul>
        </section>
        {plan.duplicates.length > 0 && (
          <section className="flex flex-col gap-1 rounded-8 bg-raised p-4">
            <p className="text-label text-yellow">{plan.duplicates.length} existing {plan.duplicates.length === 1 ? 'identifier' : 'identifiers'} — skipped</p>
            <ul>{plan.duplicates.map((d) => <li key={d.label} className="text-small text-muted">{d.label}: {d.reason}</li>)}</ul>
          </section>
        )}
        {problems > 0 && (
          <section className="flex flex-col gap-1 rounded-8 bg-raised p-4">
            <p className="text-label text-red">{problems} {problems === 1 ? 'row needs' : 'rows need'} attention</p>
            <ul>{plan.invalid.map((e) => <li key={`${e.line}:${e.message}`} className="text-small text-muted">Line {e.line} · {e.message}</li>)}</ul>
          </section>
        )}

        {results.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Import results">
            {results.map((r, i) => (
              <li key={`${r.label}:${i}`} className={`text-small ${STATUS_COLOR[r.status]}`}>
                {r.status === 'imported' && r.workId ? <Link to={`/library/${r.workId}`} className="underline">{r.label}</Link> : r.label}
                {' — '}{r.status}{r.message ? `: ${r.message}` : ''}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {!done && <Button isLoading={running} disabled={!plan.ready.length} onClick={execute}>Import {plan.ready.length} {plan.ready.length === 1 ? 'record' : 'records'}</Button>}
          {done && <Link to="/library"><Button>Go to library</Button></Link>}
          <Button variant="secondary" disabled={running} onClick={done ? () => { reset(); setStep('input'); setText(''); } : back}>{done ? 'Import more' : 'Fix remaining rows'}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <p className="text-heading text-fg">Import</p>
      <div className="flex gap-2">
        <Button variant={mode === 'doi' ? 'primary' : 'secondary'} onClick={() => setMode('doi')}>DOI list</Button>
        <Button variant={mode === 'csv' ? 'primary' : 'secondary'} onClick={() => setMode('csv')}>CSV</Button>
      </div>
      <p className="text-small text-muted">{HELP[mode]}</p>
      <textarea
        aria-label="Import data"
        className="min-h-[180px] rounded-8 border border-muted bg-dim p-4 font-mono text-body text-fg"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === 'doi' ? '10.1038/nature12373' : 'title,authors,year\nDune,Frank Herbert,1965'}
      />
      {error && <p className="text-small text-red" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {mode === 'csv' && <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => handleFile(e.target.files?.[0])} />}
        <Button isLoading={analyzing} disabled={!text.trim()} onClick={next}>{mode === 'csv' ? 'Match columns' : 'Review'}</Button>
      </div>
    </div>
  );
}
