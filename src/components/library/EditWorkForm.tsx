import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUpdateWork, useDeleteWork } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';

import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@/lib/recordTypes';

export function EditWorkForm({
  workId,
  children,
  title: initialTitle,
  subtitle: initialSubtitle,
  abstract: initialAbstract,
  language: initialLanguage,
  workType: initialWorkType,
  userRating: initialUserRating = null,
}: Readonly<{
  workId: string;
  children?: ReactNode;
  title: string;
  subtitle: string | null;
  abstract: string | null;
  language: string | null;
  workType: string;
  userRating?: number | null;
}>) {
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? '');
  const [abstract, setAbstract] = useState(initialAbstract ?? '');
  const [language, setLanguage] = useState(initialLanguage ?? '');
  const [workType, setWorkType] = useState(initialWorkType);
  const [userRating, setUserRating] = useState(initialUserRating);
  const update = useUpdateWork(workId);
  const remove = useDeleteWork();
  const [confirming, setConfirming] = useState(false);
  const previous = useRef({ title: initialTitle, subtitle: initialSubtitle ?? '', abstract: initialAbstract ?? '', language: initialLanguage ?? '', workType: initialWorkType, userRating: initialUserRating });
  const patch = { title: title.trim(), subtitle: subtitle.trim() || null, abstract: abstract.trim() || null, language: language.trim() || null, work_type: workType, ...(workType === 'book' ? { user_rating: userRating } : {}) };
  const dirty = patch.title !== initialTitle || patch.subtitle !== (initialSubtitle?.trim() || null) || patch.abstract !== (initialAbstract?.trim() || null) || patch.language !== (initialLanguage?.trim() || null) || workType !== initialWorkType || (workType === 'book' && userRating !== initialUserRating);

  useEffect(() => {
    if (title === previous.current.title) setTitle(initialTitle);
    if (subtitle === previous.current.subtitle) setSubtitle(initialSubtitle ?? '');
    if (abstract === previous.current.abstract) setAbstract(initialAbstract ?? '');
    if (language === previous.current.language) setLanguage(initialLanguage ?? '');
    if (workType === previous.current.workType) setWorkType(initialWorkType);
    if (userRating === previous.current.userRating) setUserRating(initialUserRating);
    previous.current = { title: initialTitle, subtitle: initialSubtitle ?? '', abstract: initialAbstract ?? '', language: initialLanguage ?? '', workType: initialWorkType, userRating: initialUserRating };
  }, [initialTitle, initialSubtitle, initialAbstract, initialLanguage, initialWorkType, initialUserRating]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-heading text-fg">Edit {WORK_TYPE_LABELS[workType as WorkType]?.toLowerCase() ?? 'work'}</p>
      <label className="flex flex-col gap-1 text-small text-muted">Type
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
      </label>
      <label className="text-small text-muted">{WORK_TYPE_LABELS[workType as WorkType] ?? 'Work'} title<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" /></label>
      <label className="text-small text-muted">Subtitle (optional)<Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (optional)" /></label>
      {children}
      <label className="text-small text-muted">Language<Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language (BCP 47)" /></label>
      <label className="flex flex-col text-small text-muted">{['book', 'serial', 'standard', 'other'].includes(workType) ? 'Description' : 'Abstract'} (optional)
      <textarea className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={abstract} onChange={(e) => setAbstract(e.target.value)} placeholder="Abstract (optional)" rows={3} />
      </label>
      {workType === 'book' && <label className="text-small text-muted">Your rating
        <select aria-label="Your rating" className="block w-full rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={userRating ?? ''} onChange={(e) => setUserRating(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}
        </select>
      </label>}
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
