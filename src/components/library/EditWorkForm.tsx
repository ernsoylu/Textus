import { useEffect, useRef, useState } from 'react';
import { useUpdateWork, useDeleteWork } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';

import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@/lib/recordTypes';

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
  const [confirming, setConfirming] = useState(false);
  const previous = useRef({ title: initialTitle, subtitle: initialSubtitle ?? '', abstract: initialAbstract ?? '', language: initialLanguage ?? '', workType: initialWorkType });
  const patch = { title: title.trim(), subtitle: subtitle.trim() || null, abstract: abstract.trim() || null, language: language.trim() || null, work_type: workType };
  const dirty = patch.title !== initialTitle || patch.subtitle !== (initialSubtitle?.trim() || null) || patch.abstract !== (initialAbstract?.trim() || null) || patch.language !== (initialLanguage?.trim() || null) || workType !== initialWorkType;

  useEffect(() => {
    if (title === previous.current.title) setTitle(initialTitle);
    if (subtitle === previous.current.subtitle) setSubtitle(initialSubtitle ?? '');
    if (abstract === previous.current.abstract) setAbstract(initialAbstract ?? '');
    if (language === previous.current.language) setLanguage(initialLanguage ?? '');
    if (workType === previous.current.workType) setWorkType(initialWorkType);
    previous.current = { title: initialTitle, subtitle: initialSubtitle ?? '', abstract: initialAbstract ?? '', language: initialLanguage ?? '', workType: initialWorkType };
  }, [initialTitle, initialSubtitle, initialAbstract, initialLanguage, initialWorkType]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-heading text-fg">Edit {WORK_TYPE_LABELS[workType as WorkType]?.toLowerCase() ?? 'work'}</p>
      <label className="text-small text-muted">{WORK_TYPE_LABELS[workType as WorkType] ?? 'Work'} title<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" /></label>
      <label className="text-small text-muted">Subtitle (optional)<Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (optional)" /></label>
      <label className="text-small text-muted">Language<Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language (BCP 47)" /></label>
      <label className="flex flex-col text-small text-muted">{['book', 'serial', 'standard', 'other'].includes(workType) ? 'Description' : 'Abstract'} (optional)
      <textarea className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="Abstract (optional)" rows={3} />
      </label>
      <select
        aria-label="Work type"
        className="rounded-8 border border-muted bg-dim p-4 text-body text-fg"
        value={workType}
        onChange={(e) => setWorkType(e.target.value)}
      >
        {WORK_TYPES.map((t) => (
          <option key={t} value={t}>
            {WORK_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          isLoading={update.isPending}
          disabled={!title.trim()}
          onClick={() => update.mutate(patch)}
        >
          Save
        </Button>
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
        >
          Delete work
        </Button>
      </div>
      <UnsavedChangesGuard dirty={dirty && !!title.trim()} subject="work" onSave={() => update.mutateAsync(patch)} />
      <ConfirmDialog
        open={confirming}
        title={`Delete "${initialTitle}"?`}
        description="This removes the work with all its records, identifiers, credits, notes and reading progress. Its files are deleted from storage within a day. This cannot be undone."
        confirmLabel="Delete work"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(workId, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
      {update.isError && <p className="text-small text-red">{update.error.message}</p>}
    </div>
  );
}
