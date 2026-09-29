import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseIdentifier, type IdentifierScheme } from 'shared/identifier';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SCHEMES: IdentifierScheme[] = ['isbn', 'doi', 'issn', 'arxiv', 'pmid'];

// FR-CAT-4: validate and normalize before writing (shared/identifier.ts, never JSONB).
// FR-CAT-5: warn — not block — when the normalized value is already in the user's library.
async function addIdentifier(recordId: string, scheme: IdentifierScheme, raw: string) {
  const parsed = parseIdentifier(scheme, raw);
  if (!parsed.ok) {
    throw new Error(parsed.reason === 'invalid_check_digit' ? 'That check digit is not valid.' : 'That does not look like a valid ' + scheme.toUpperCase() + '.');
  }

  const { error: insertError } = await supabase
    .from('identifiers')
    .insert({ record_id: recordId, scheme, normalized_value: parsed.normalized, original_value: parsed.original });
  if (insertError) {
    if (insertError.code === '23505') throw new Error('This record already has that identifier.');
    throw insertError;
  }

  if (parsed.scheme === 'arxiv' && parsed.arxivVersion !== undefined) {
    const { data: record } = await supabase.from('records').select('metadata').eq('id', recordId).single();
    await supabase
      .from('records')
      .update({ metadata: { ...(record?.metadata as object), arxiv_version: parsed.arxivVersion } })
      .eq('id', recordId);
  }

  const { data: existingElsewhere } = await supabase
    .from('identifiers')
    .select('record_id')
    .eq('scheme', scheme)
    .eq('normalized_value', parsed.normalized)
    .neq('record_id', recordId);

  return { duplicateCount: existingElsewhere?.length ?? 0 };
}

export function AddIdentifierForm({ recordId }: Readonly<{ recordId: string }>) {
  const queryClient = useQueryClient();
  const [scheme, setScheme] = useState<IdentifierScheme>('isbn');
  const [value, setValue] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => addIdentifier(recordId, scheme, value),
    onSuccess: ({ duplicateCount }) => {
      setValue('');
      setDuplicateWarning(
        duplicateCount > 0 ? 'Another record in your library already has this identifier.' : null,
      );
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicateWarning(null);
    if (value.trim()) mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
      <select
        className="rounded-8 border border-muted bg-dim p-4 text-body text-fg"
        value={scheme}
        onChange={(e) => setScheme(e.target.value as IdentifierScheme)}
      >
        {SCHEMES.map((s) => (
          <option key={s} value={s}>
            {s.toUpperCase()}
          </option>
        ))}
      </select>
      <Input
        placeholder="Identifier"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={mutation.isError ? mutation.error.message : undefined}
        className="w-auto min-w-[200px]"
      />
      <Button type="submit" variant="secondary" isLoading={mutation.isPending} disabled={!value.trim()}>
        Add
      </Button>
      {duplicateWarning && <p className="w-full text-small text-yellow">{duplicateWarning}</p>}
    </form>
  );
}
