import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useImport } from '@/hooks/useImport';
import { Button } from '@/components/ui/button';

const STATUS_COLOR = { imported: 'text-green', skipped: 'text-yellow', failed: 'text-red' } as const;

const HELP = {
  doi: 'One DOI per line. Each is looked up (Crossref) and imported only if the provider returns real data.',
  csv: 'Header row required. Columns: title, authors (separate with ;), year, publisher, doi, isbn, type, language.',
} as const;

// FR-RES-3: bulk import from CSV or a list of DOIs.
export function Import() {
  const [mode, setMode] = useState<'doi' | 'csv'>('doi');
  const [text, setText] = useState('');
  const { run, results, parseErrors, running } = useImport();

  async function handleFile(file: File | undefined) {
    if (file) setText(await file.text());
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
      <div className="flex items-center gap-3">
        {mode === 'csv' && <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => handleFile(e.target.files?.[0])} />}
        <Button isLoading={running} disabled={!text.trim()} onClick={() => run(mode, text)}>Import</Button>
      </div>

      {parseErrors.length > 0 && (
        <ul className="flex flex-col gap-1">{parseErrors.map((m) => <li key={m} className="text-small text-red">{m}</li>)}</ul>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((r, i) => (
            <li key={`${r.label}:${i}`} className={`text-small ${STATUS_COLOR[r.status]}`}>
              {r.status === 'imported' && r.workId ? <Link to={`/library/${r.workId}`} className="underline">{r.label}</Link> : r.label}
              {' — '}{r.status}{r.message ? `: ${r.message}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
