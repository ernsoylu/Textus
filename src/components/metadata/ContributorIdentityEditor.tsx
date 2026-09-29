import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fold, parseName } from 'shared/names';
import { parseAuthorityIdentifier, type AuthorityScheme } from 'shared/identifier';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SCHEMES: AuthorityScheme[] = ['orcid', 'isni', 'viaf', 'wikidata', 'openlibrary', 'semantic_scholar'];
const TYPES = ['variant', 'pseudonym', 'transliteration', 'former'] as const;

export function ContributorIdentityEditor({ id, name }: Readonly<{ id: string; name: string }>) {
  const queryClient = useQueryClient();
  const [nameText, setNameText] = useState('');
  const [nameType, setNameType] = useState<(typeof TYPES)[number]>('variant');
  const [scheme, setScheme] = useState<AuthorityScheme>('orcid');
  const [idText, setIdText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const details = useQuery({ queryKey: ['contributor-identity', id], queryFn: async () => {
    const [names, identifiers] = await Promise.all([
      supabase.from('contributor_names').select('id,name,name_type').eq('contributor_id', id),
      supabase.from('contributor_identifiers').select('id,scheme,value').eq('contributor_id', id),
    ]);
    if (names.error) throw names.error;
    if (identifiers.error) throw identifiers.error;
    return { names: names.data, identifiers: identifiers.data };
  } });

  async function saveName() {
    if (!nameText.trim()) return;
    setSaving(true); setError('');
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sign in again.');
      const parts = parseName(nameText).parts;
      const { error: saveError } = await supabase.from('contributor_names').insert({ user_id: auth.user.id, contributor_id: id, name: nameText.trim(), match_key: fold(parts?.kind === 'person' ? parts.familyName : nameText), name_type: nameType });
      if (saveError) throw saveError;
      setNameText('');
      await queryClient.invalidateQueries({ queryKey: ['contributor-identity', id] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save name.'); }
    finally { setSaving(false); }
  }
  async function saveId() {
    const normalized = parseAuthorityIdentifier(scheme, idText);
    if (!normalized) { setError(`Invalid ${scheme} identifier.`); return; }
    setSaving(true); setError('');
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sign in again.');
      const { error: saveError } = await supabase.from('contributor_identifiers').insert({ user_id: auth.user.id, contributor_id: id, scheme, value: normalized });
      if (saveError) throw saveError;
      setIdText('');
      await queryClient.invalidateQueries({ queryKey: ['contributor-identity', id] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save identifier.'); }
    finally { setSaving(false); }
  }

  return <details className="rounded-8 border border-border p-2 text-small text-fg">
    <summary className="cursor-pointer">Names and authority IDs: {name}</summary>
    {details.isError && <p className="text-red">{details.error.message}</p>}
    {details.data?.names.map((item) => <p key={item.id}>{item.name_type}: {item.name}</p>)}
    {details.data?.identifiers.map((item) => <p key={item.id}>{item.scheme}: {item.value}</p>)}
    <div className="flex flex-wrap gap-2 pt-2">
      <select aria-label="Name type" value={nameType} onChange={(e) => setNameType(e.target.value as (typeof TYPES)[number])} className="rounded-8 border border-muted bg-dim p-2 text-fg">{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      <Input value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="Other name" className="w-auto flex-1" />
      <Button variant="secondary" onClick={saveName} disabled={saving || !nameText.trim()}>Add name</Button>
    </div>
    <div className="flex flex-wrap gap-2 pt-2">
      <select aria-label="Authority scheme" value={scheme} onChange={(e) => setScheme(e.target.value as AuthorityScheme)} className="rounded-8 border border-muted bg-dim p-2 text-fg">{SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <Input value={idText} onChange={(e) => setIdText(e.target.value)} placeholder="Authority ID" className="w-auto flex-1" />
      <Button variant="secondary" onClick={saveId} disabled={saving || !idText.trim()}>Add ID</Button>
    </div>
    {error && <p className="text-red" role="alert">{error}</p>}
  </details>;
}
