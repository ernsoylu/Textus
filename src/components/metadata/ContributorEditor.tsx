import { useState } from 'react';
import { splitNames, type Role } from 'shared/names';
import { useSaveCredits, type CreditInput } from '@/hooks/useContributorCredits';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ContributorIdentityEditor } from './ContributorIdentityEditor';

const ROLES: Role[] = ['author', 'editor', 'compiler', 'translator', 'illustrator', 'series_editor', 'introduction', 'contributor'];

interface Row extends CreditInput {
  key: string;
  rejected: boolean;
  skip: boolean;
}

let nextKey = 0;

export interface ExistingCredit {
  contributor_id: string;
  role: string;
  position: number;
  credited_as: string | null;
  contributors: {
    display_name: string;
    kind: string;
    family_name: string | null;
    given_names: string | null;
    particle: string | null;
    suffix: string | null;
  } | null;
}

function rowsFromExisting(credits: ExistingCredit[]): Row[] {
  return [...credits]
    .filter((c) => c.contributors)
    .sort((a, b) => a.role.localeCompare(b.role) || a.position - b.position)
    .map((c) => {
      const contributor = c.contributors!;
      const isOrg = contributor.kind === 'organization';
      return {
        key: String(nextKey++),
        contributorId: c.contributor_id,
        rejected: false,
        skip: false,
        kind: isOrg ? 'organization' : 'person',
        creditedAs: c.credited_as ?? '',
        organizationName: isOrg ? contributor.display_name : '',
        familyName: contributor.family_name ?? '',
        givenNames: contributor.given_names ?? '',
        particle: contributor.particle ?? '',
        suffix: contributor.suffix ?? '',
        role: c.role as Role,
      };
    });
}

// FR-CONTRIB-2/3: paste text -> preview via shared/names.ts splitNames() -> editable rows ->
// saved through set_record_contributors() (invariant 8). Seeded from the record's existing
// credits, since that RPC replaces the whole list — pasting more must add to, not erase, them.
export function ContributorEditor({ workId, recordId, existingCredits }: { workId: string; recordId: string; existingCredits: ExistingCredit[] }) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromExisting(existingCredits));
  const [pasteText, setPasteText] = useState('');
  const save = useSaveCredits(workId, recordId);

  function handleParse() {
    if (!pasteText.trim()) return;
    const parsed = splitNames(pasteText);
    const newRows: Row[] = parsed.map((c) => {
      const isOrg = c.parts?.kind === 'organization';
      const person = c.parts?.kind === 'person' ? c.parts : null;
      return {
        key: String(nextKey++),
        rejected: c.rejected,
        skip: c.rejected,
        kind: isOrg ? 'organization' : 'person',
        creditedAs: c.raw,
        organizationName: isOrg ? c.parts!.displayName : '',
        familyName: person?.familyName ?? '',
        givenNames: person?.givenNames ?? '',
        particle: person?.particle ?? '',
        suffix: person?.suffix ?? '',
        role: c.roles[0] ?? 'author',
      };
    });
    setRows((prev) => [...prev, ...newRows]);
    setPasteText('');
  }

  function updateRow(key: string, patch: Partial<Row>) {
    const identityChanged = ['kind', 'organizationName', 'familyName', 'givenNames', 'particle', 'suffix'].some((field) => field in patch);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, contributorId: identityChanged ? undefined : r.contributorId } : r)));
  }
  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const kept = rows.filter((r) => !r.skip);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder='Paste names, e.g. "Tolkien, J. R. R. & Christopher Tolkien"'
          className="w-auto min-w-[320px] flex-1"
        />
        <Button variant="secondary" onClick={handleParse} disabled={!pasteText.trim()}>
          Parse
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.key} className={`flex flex-wrap items-center gap-2 rounded-8 border p-2 ${row.rejected ? 'border-yellow' : 'border-border'}`}>
              <input
                type="checkbox"
                checked={!row.skip}
                onChange={(e) => updateRow(row.key, { skip: !e.target.checked })}
                aria-label="Include this credit"
              />
              {row.rejected && <span className="text-small text-yellow">doesn't look like a name —</span>}
              {row.kind === 'organization' ? (
                <Input
                  value={row.organizationName}
                  onChange={(e) => updateRow(row.key, { organizationName: e.target.value })}
                  placeholder="Organization name"
                  className="w-auto min-w-[200px]"
                />
              ) : (
                <>
                  <Input value={row.familyName} onChange={(e) => updateRow(row.key, { familyName: e.target.value })} placeholder="Family name" className="w-auto min-w-[120px]" />
                  <Input value={row.givenNames} onChange={(e) => updateRow(row.key, { givenNames: e.target.value })} placeholder="Given names" className="w-auto min-w-[140px]" />
                  <Input value={row.particle} onChange={(e) => updateRow(row.key, { particle: e.target.value })} placeholder="Particle" className="w-auto min-w-[80px]" />
                  <Input value={row.suffix} onChange={(e) => updateRow(row.key, { suffix: e.target.value })} placeholder="Suffix" className="w-auto min-w-[70px]" />
                </>
              )}
              <select
                className="rounded-8 border border-muted bg-dim p-2 text-small text-fg"
                value={row.role}
                onChange={(e) => updateRow(row.key, { role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => removeRow(row.key)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button isLoading={save.isPending} onClick={() => save.mutate(kept)}>
          Save credits
        </Button>
        {save.isError && <p className="text-small text-red">{save.error.message}</p>}
      </div>
      {[...new Map(existingCredits.filter((credit) => credit.contributors).map((credit) => [credit.contributor_id, credit.contributors!.display_name])).entries()].map(([id, name]) => <ContributorIdentityEditor key={id} id={id} name={name} />)}
    </div>
  );
}
