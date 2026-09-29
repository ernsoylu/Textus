import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { exportRecords } from '@/lib/functions';
import { downloadText } from '@/lib/annotationExport';
import { Button } from '@/components/ui/button';

const FORMATS = [
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
  { value: 'csl-json', label: 'CSL-JSON' },
] as const;

// FR-RES-1: citations for the given records via the `export` Edge Function (§8.4).
export function ExportButton({ recordIds }: { recordIds: string[] }) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]['value']>('bibtex');
  const mutation = useMutation({
    mutationFn: () => exportRecords(recordIds, format),
    onSuccess: (r) => downloadText(r.filename, r.content, r.mime),
  });
  return (
    <span className="flex items-center gap-2">
      <select aria-label="Export format" className="rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
        {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <Button variant="secondary" disabled={!recordIds.length} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>Export citations</Button>
      {mutation.error && <span className="text-small text-red">Export failed. Try again.</span>}
    </span>
  );
}
