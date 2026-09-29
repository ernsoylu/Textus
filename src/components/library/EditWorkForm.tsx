import { useState } from 'react';
import { useUpdateWork, useDeleteWork } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const WORK_TYPES = ['book', 'article', 'chapter', 'serial', 'thesis', 'report', 'other'] as const;

export function EditWorkForm({
  workId,
  title: initialTitle,
  subtitle: initialSubtitle,
  abstract: initialAbstract,
  language: initialLanguage,
  workType: initialWorkType,
}: Readonly<{
  workId: string;
  title: string;
  subtitle: string | null;
  abstract: string | null;
  language: string | null;
  workType: string;
}>) {
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? '');
  const [abstract, setAbstract] = useState(initialAbstract ?? '');
  const [language, setLanguage] = useState(initialLanguage ?? '');
  const [workType, setWorkType] = useState(initialWorkType);
  const update = useUpdateWork(workId);
  const remove = useDeleteWork();

  return (
    <div className="flex flex-col gap-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (optional)" />
      <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language (BCP 47)" />
      <textarea className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="Abstract (optional)" rows={3} />
      <select
        className="rounded-8 border border-muted bg-dim p-4 text-body text-fg"
        value={workType}
        onChange={(e) => setWorkType(e.target.value)}
      >
        {WORK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          isLoading={update.isPending}
          disabled={!title.trim()}
          onClick={() => update.mutate({ title: title.trim(), subtitle: subtitle.trim() || null, abstract: abstract.trim() || null, language: language.trim() || null, work_type: workType })}
        >
          Save
        </Button>
        <Button
          variant="danger"
          isLoading={remove.isPending}
          onClick={() => {
            if (confirm(`Delete "${initialTitle}" and all its records, files, and credits? This cannot be undone.`)) {
              remove.mutate(workId);
            }
          }}
        >
          Delete work
        </Button>
      </div>
      {update.isError && <p className="text-small text-red">{update.error.message}</p>}
      {remove.isError && <p className="text-small text-red">{remove.error.message}</p>}
    </div>
  );
}
