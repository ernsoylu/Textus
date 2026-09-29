import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { compareGiven, parseName } from 'shared/names';

// FR-CONTRIB-7..9. Merge and split go only through merge_contributors() / reassign_credits()
// (CLAUDE.md invariant 8); the SPA never rewrites record_contributors directly.
export function useContributors() {
  return useQuery({
    queryKey: ['contributors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contributors')
        .select('id, display_name, sort_name, kind, given_names, status, record_contributors(count)')
        .order('sort_name');
      if (error) throw error;
      return data.map((c) => ({ ...c, credits: c.record_contributors[0]?.count ?? 0 }));
    },
  });
}

export type ContributorListItem = NonNullable<ReturnType<typeof useContributors>['data']>[number];

// Review queue: same-key pairs from the server, minus pairs whose given names are incompatible.
export function useDuplicatePairs() {
  const contributors = useContributors();
  return useQuery({
    queryKey: ['contributor-duplicates', contributors.dataUpdatedAt],
    enabled: !!contributors.data,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('possible_duplicate_contributors');
      if (error) throw error;
      const byId = new Map(contributors.data!.map((c) => [c.id, c]));
      return data.flatMap((p) => {
        const a = byId.get(p.contributor_a);
        const b = byId.get(p.contributor_b);
        return a && b && a.kind === b.kind && compareGiven(a.given_names, b.given_names) !== 'incompatible' ? [{ a, b }] : [];
      });
    },
  });
}

export function useContributor(id: string | undefined) {
  return useQuery({
    queryKey: ['contributors', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contributors')
        .select(
          `id, display_name, kind, status, given_names, family_name, birth_year, death_year, notes,
           contributor_names ( name, name_type ),
           contributor_identifiers ( scheme, value ),
           record_contributors ( record_id, role, position, credited_as, records ( title, work_id, works ( title ) ) )`,
        )
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

function useInvalidatingMutation<V>(fn: (v: V) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => queryClient.invalidateQueries() });
}

export function useMergeContributors() {
  return useInvalidatingMutation(async ({ keep, merge, force }: { keep: string; merge: string; force?: boolean }) => {
    const { error } = await supabase.rpc('merge_contributors', { p_keep: keep, p_merge: merge, p_force: force ?? false });
    if (error) throw error;
  });
}

export function useNotSamePerson() {
  return useInvalidatingMutation(async ({ a, b }: { a: string; b: string }) => {
    const { data: userData } = await supabase.auth.getUser();
    const [contributor_a, contributor_b] = a < b ? [a, b] : [b, a];
    const { error } = await supabase.from('contributor_distinctions').insert({ user_id: userData.user!.id, contributor_a, contributor_b });
    if (error && error.code !== '23505') throw error;
  });
}

export function useConfirmContributor() {
  return useInvalidatingMutation(async (id: string) => {
    const { error } = await supabase.from('contributors').update({ status: 'confirmed' }).eq('id', id);
    if (error) throw error;
  });
}

// Split: move the credits on `recordIds` from `from` to an existing contributor, or to a new one
// created from `newName` (parsed with shared/names.ts). reassign_credits() also records that the
// two are different people.
export function useSplitCredits() {
  const { session } = useAuth();
  return useInvalidatingMutation(async ({ from, recordIds, to, newName }: { from: string; recordIds: string[]; to?: string; newName?: string }) => {
    let target = to;
    if (!target) {
      const { parts } = parseName(newName ?? '');
      const person = parts.kind === 'person' ? parts : null;
      const { data, error } = await supabase
        .from('contributors')
        .insert({
          user_id: session!.user.id,
          kind: parts.kind,
          display_name: parts.displayName,
          family_name: person?.familyName ?? null,
          given_names: person?.givenNames ?? null,
          particle: person?.particle ?? null,
          suffix: person?.suffix ?? null,
          sort_name: parts.sortName,
          match_key: parts.matchKey,
        })
        .select('id')
        .single();
      if (error) throw error;
      target = data.id;
    }
    const { error } = await supabase.rpc('reassign_credits', { p_from: from, p_to: target, p_record_ids: recordIds });
    if (error) throw error;
  });
}

// Credits go with the contributor (record_contributors ON DELETE CASCADE), so the UI warns first.
export function useDeleteContributor() {
  return useInvalidatingMutation(async (id: string) => {
    const { error } = await supabase.from('contributors').delete().eq('id', id);
    if (error) throw error;
  });
}
