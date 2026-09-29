import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fold, compareGiven, type Role } from 'shared/names';

export interface CreditInput {
  contributorId?: string;
  kind: 'person' | 'organization';
  creditedAs: string; // as printed/pasted; becomes credited_as only when it differs from the canonical name
  organizationName: string; // organization only
  familyName: string; // person only
  givenNames: string;
  particle: string;
  suffix: string;
  role: Role;
}

function canonicalName(row: CreditInput): string {
  return row.kind === 'organization' ? row.organizationName : [row.givenNames, row.particle, row.familyName].filter(Boolean).join(' ');
}

// Find-or-create per contributor, then set_record_contributors() (CLAUDE.md invariant 8:
// credits are saved through this RPC, never a direct record_contributors insert).
//
// Manual edits preserve existing contributor IDs. New typed names reuse a unique compatible
// contributor; ambiguous names become provisional for later review.
async function resolveContributor(userId: string, row: CreditInput): Promise<{ id: string; resolvedBy: 'user' | 'match' | 'new' }> {
  if (row.contributorId) return { id: row.contributorId, resolvedBy: 'user' };
  const matchKey = row.kind === 'organization' ? fold(row.organizationName) : fold(row.familyName);

  const { data: candidates, error: candidateError } = await supabase
    .from('contributors')
    .select('id, given_names, kind')
    .eq('user_id', userId)
    .eq('match_key', matchKey);
  if (candidateError) throw candidateError;

  const compatible = (candidates ?? []).filter((c) => c.kind === row.kind && (row.kind === 'organization' || ['exact', 'full'].includes(compareGiven(c.given_names, row.givenNames))));
  if (compatible.length === 1) return { id: compatible[0].id, resolvedBy: 'match' };

  const displayName = canonicalName(row);
  const sortName =
    row.kind === 'organization'
      ? displayName
      : [row.particle, row.familyName].filter(Boolean).join(' ') + (row.givenNames ? `, ${row.givenNames}` : '');
  const { data: created, error: insertError } = await supabase
    .from('contributors')
    .insert({
      user_id: userId,
      kind: row.kind,
      display_name: displayName,
      family_name: row.kind === 'person' ? row.familyName : null,
      given_names: row.kind === 'person' ? row.givenNames || null : null,
      particle: row.kind === 'person' ? row.particle || null : null,
      suffix: row.kind === 'person' ? row.suffix || null : null,
      sort_name: sortName,
      match_key: matchKey,
      status: compatible.length ? 'provisional' : 'confirmed',
    })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return { id: created.id, resolvedBy: 'new' };
}

// Also used by bulk import (src/hooks/useImport.ts). `lock` marks credits as manually edited (FR-META-3);
// imports of provider data pass lock: false so a later lookup may still refine them.
export async function saveCredits(recordId: string, rows: CreditInput[], { lock = true } = {}): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const byRole = new Map<Role, number>();
  const credits = [];
  for (const row of rows) {
    const { id, resolvedBy } = await resolveContributor(userId, row);
    const position = byRole.get(row.role) ?? 0;
    byRole.set(row.role, position + 1);
    const creditedAs = row.creditedAs.trim();
    credits.push({
      contributor_id: id,
      role: row.role,
      position,
      credited_as: creditedAs && creditedAs !== canonicalName(row) ? creditedAs : null,
      affiliation: null,
      resolved_by: resolvedBy,
    });
  }

  const { error } = await supabase.rpc('set_record_contributors', { p_record_id: recordId, p_credits: credits });
  if (error) throw error;
  if (!lock) return;
  const { data: record, error: readError } = await supabase.from('records').select('metadata').eq('id', recordId).single();
  if (readError) throw readError;
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const locked = new Set(Array.isArray(metadata.locked_fields) ? metadata.locked_fields as string[] : []);
  locked.add('contributors');
  const { error: lockError } = await supabase.from('records').update({ metadata: { ...metadata, locked_fields: [...locked] } }).eq('id', recordId);
  if (lockError) throw lockError;
}

export function useSaveCredits(workId: string, recordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: CreditInput[]) => {
      await saveCredits(recordId, rows);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works', workId] });
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}
