import { useState } from 'react';
import { useLinkableRecords, useLinkVersion } from '@/hooks/useCatalogMutations';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "link version": "Two versions, one work." — pull an existing record (say a preprint that was
// catalogued on its own) under this work, so the preprint and its published version sit together.
export function LinkVersionDialog({ workId, open, onClose }: Readonly<{ workId: string; open: boolean; onClose: () => void }>) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; fromWorkId: string } | null>(null);
  const [version, setVersion] = useState('published');
  const found = useLinkableRecords(workId, search);
  const link = useLinkVersion(workId);

  const idLabel = (ids: { scheme: string; normalized_value: string }[]) => ids.map((i) => `${i.scheme.toUpperCase()} ${i.normalized_value}`).join(' · ');
  const close = () => {
    setSearch('');
    setSelected(null);
    link.reset();
    onClose();
  };

  return (
    <ModalDialog open={open} title="Two versions, one work." onClose={close}>
      <p className="text-body text-muted">Link a preprint and its published version.</p>
      <label className="flex flex-col gap-2 text-small text-fg">
        Find a record
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title of the other version" />
      </label>
      <ul className="flex flex-col gap-2">
        {found.data?.map((r) => {
          const title = r.works?.title ?? 'Untitled';
          const active = selected?.id === r.id;
          const kind = typeof (r.metadata as { version?: unknown } | null)?.version === 'string' ? (r.metadata as { version: string }).version : '';
          return (
            <li key={r.id}>
              <button type="button" aria-pressed={active} onClick={() => setSelected({ id: r.id, fromWorkId: r.work_id })} className={`flex w-full items-center justify-between gap-2 rounded-8 p-3 text-left ${active ? 'bg-green-bg' : 'bg-dim hover:bg-raised'}`}>
                <span className="flex flex-col">
                  <span className="text-body text-fg">{title}</span>
                  <span className="text-small text-muted">{[idLabel(r.identifiers), kind, r.publication_date?.slice(0, 4)].filter(Boolean).join(' · ')}</span>
                </span>
                {active && <span className="text-small text-green">Selected</span>}
              </button>
            </li>
          );
        })}
        {found.data?.length === 0 && <li className="text-small text-muted">No other article versions match “{search.trim()}”.</li>}
      </ul>
      <label className="flex items-center gap-2 text-small text-fg">
        This record is the
        <select aria-label="Version" className="rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={version} onChange={(e) => setVersion(e.target.value)}>
          <option value="published">published version</option>
          <option value="preprint">preprint</option>
        </select>
      </label>
      <p className="rounded-8 bg-green-bg p-3 text-small text-fg">Each version keeps its own files, credits, metadata and annotations.</p>
      {link.error && <p className="text-small text-red" role="alert">{link.error.message}</p>}
      <div className="flex gap-2">
        <Button isLoading={link.isPending} disabled={!selected} onClick={() => selected && link.mutate({ recordId: selected.id, fromWorkId: selected.fromWorkId, version }, { onSuccess: close })}>Link under the same work</Button>
        <Button variant="secondary" onClick={close}>Cancel</Button>
      </div>
    </ModalDialog>
  );
}
