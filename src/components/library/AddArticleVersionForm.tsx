import { useState } from 'react';
import { useAddRecord } from '@/hooks/useCatalogMutations';
import { Button } from '@/components/ui/button';
import { LinkVersionDialog } from '@/components/library/LinkVersionDialog';

// FR-RES-2: a preprint and its published version are two article_version records under one work.
export function AddArticleVersionForm({ workId }: Readonly<{ workId: string }>) {
  const add = useAddRecord(workId);
  const [version, setVersion] = useState<'preprint' | 'published'>('published');
  const [linking, setLinking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Version" className="rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={version} onChange={(e) => setVersion(e.target.value as typeof version)}>
        <option value="preprint">preprint</option>
        <option value="published">published version</option>
      </select>
      <Button variant="secondary" isLoading={add.isPending} onClick={() => add.mutate({ record_type: 'article_version', metadata: { version } })}>Add version</Button>
      <Button variant="ghost" onClick={() => setLinking(true)}>Link an existing record</Button>
      <LinkVersionDialog workId={workId} open={linking} onClose={() => setLinking(false)} />
      {add.error && <p className="text-small text-red">{add.error.message}</p>}
    </div>
  );
}
