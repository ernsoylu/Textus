import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

const WORK_TYPES = ['book', 'article', 'chapter', 'serial', 'thesis', 'report', 'other'] as const;

// FR-CAT-1/2: creates a work and its first record. The optional author field creates
// one contributor; the record page supports structured credits and metadata matching.
async function createWork(userId: string, title: string, workType: string, authorName: string) {
  const { data: work, error: workError } = await supabase
    .from('works')
    .insert({ user_id: userId, title, work_type: workType, metadata: { locked_fields: ['title', 'work_type'] } } as never)
    .select('id')
    .single();
  if (workError) throw workError;

  const { data: record, error: recordError } = await supabase
    .from('records')
    .insert({ work_id: work.id, record_type: 'edition', metadata: authorName.trim() ? { locked_fields: ['contributors'] } : {} })
    .select('id')
    .single();
  if (recordError) throw recordError;

  const trimmed = authorName.trim();
  if (trimmed) {
    const familyName = trimmed.split(/\s+/).at(-1)!;
    // ponytail: naive match_key (lowercased family name only); shared/names.ts fold() covers
    // particles/diacritics properly once the contributor-matching slice is built.
    const { data: contributor, error: contributorError } = await supabase
      .from('contributors')
      .insert({
        user_id: userId,
        display_name: trimmed,
        family_name: familyName,
        sort_name: trimmed,
        match_key: familyName.toLowerCase(),
      })
      .select('id')
      .single();
    if (contributorError) throw contributorError;

    const { error: creditError } = await supabase
      .from('record_contributors')
      .insert({ record_id: record.id, contributor_id: contributor.id, role: 'author', position: 0, resolved_by: 'new' });
    if (creditError) throw creditError;
  }

  return work.id;
}

export function NewWork() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState<(typeof WORK_TYPES)[number]>('book');
  const [author, setAuthor] = useState('');

  const mutation = useMutation({
    mutationFn: () => createWork(session!.user.id, title.trim(), workType, author),
    onSuccess: (workId) => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
      navigate(`/library/${workId}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-[424px] flex-col gap-4">
      <p className="text-heading text-fg">Add a work</p>

      <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select
        className="rounded-8 border border-muted bg-dim p-4 text-body text-fg"
        value={workType}
        onChange={(e) => setWorkType(e.target.value as (typeof WORK_TYPES)[number])}
      >
        {WORK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <Input placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />

      {mutation.isError && <p className="text-small text-red">{mutation.error.message}</p>}

      <Button type="submit" isLoading={mutation.isPending} disabled={!title.trim()}>
        {mutation.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
