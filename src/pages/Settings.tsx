import { useState, type FormEvent } from 'react';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { SignOutButton } from '@/components/account/SignOutButton';
import { useAuth } from '@/hooks/useAuth';
import { PasswordForm } from '@/components/account/PasswordForm';
import { AgentTab } from '@/components/account/AgentTab';
import { AiTab } from '@/components/account/AiTab';
import { AppearanceTab } from '@/components/account/AppearanceTab';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { deleteAccount } from '@/lib/functions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearchParams } from 'react-router-dom';

// Figma "settings", "appearance" and "opds": Account, Appearance and OPDS tabs.
const TABS = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'opds', label: 'OPDS' },
  { id: 'ai', label: 'AI' },
  { id: 'agents', label: 'Agents' },
] as const;

function AccountTab() {
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState<string>(session?.user.user_metadata?.display_name ?? '');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const savedName: string = session?.user.user_metadata?.display_name ?? '';
  const saveName = () => supabase.auth.updateUser({ data: { display_name: displayName.trim() } }).then(({ error }) => { if (error) throw error; });

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
    setProfileMessage(error ? error.message : 'Profile saved.');
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      // The account is gone server-side; drop the local session (its token no longer resolves to a user).
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete the account.');
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <UnsavedChangesGuard dirty={displayName.trim() !== savedName} subject="profile" onSave={saveName} />
      <form onSubmit={saveProfile} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-small text-fg">
          Display name
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-small text-fg">
          Email
          <Input value={session?.user.email ?? ''} readOnly />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Save profile</Button>
          <Button type="button" variant="secondary" onClick={() => setChangingPassword((open) => !open)}>Change password</Button>
          {profileMessage && <output className="text-small text-muted">{profileMessage}</output>}
        </div>
      </form>

      {changingPassword && (
        <div className="flex flex-col gap-3 rounded-8 border border-border p-4">
          <p className="text-label text-fg">Set or change password</p>
          <PasswordForm submitLabel="Save password" />
        </div>
      )}

      <div className="rounded-8 bg-raised p-4">
        <p className="text-label text-fg">Your library stays private</p>
        <p className="text-body text-muted">Only your account can access your records, files and annotations.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SignOutButton />
        <Button variant="ghost" onClick={() => setDeleting(true)}>Delete account</Button>
      </div>
      <ConfirmDialog
        open={deleting}
        title="Delete your library and account?"
        description="All records, reading progress and annotations will be permanently removed. Stored files are removed by background cleanup. This action cannot be undone."
        confirmLabel="Delete account"
        cancelLabel="Keep it"
        requireText="DELETE"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(false)}
      />
    </div>
  );
}

function OpdsTab({ onCreateToken }: Readonly<{ onCreateToken: () => void }>) {
  const catalogUrl = `${supabaseUrl}/functions/v1/opds`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(catalogUrl);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-small text-fg">
        Catalog URL
        <Input value={catalogUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={copy}>Copy catalog URL</Button>
        {copied && <output className="text-small text-green">Copied.</output>}
      </div>
      <div className="rounded-8 bg-raised p-4">
        <p className="text-label text-fg">Connect your reader</p>
        <ol className="list-decimal pl-5 text-body text-muted">
          <li>Add an OPDS catalog in your reader.</li>
          <li>Paste the catalog URL above.</li>
          <li>Sign in with any username and a read-only agent token as the password.</li>
        </ol>
      </div>
      <p className="text-small text-muted">
        Your account password is not accepted here. Revoke the token to disconnect the reader.{' '}
        <button type="button" className="text-green underline" onClick={onCreateToken}>Create a token</button>
      </p>
    </div>
  );
}

export function Settings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(() => TABS.find((t) => t.id === params.get('tab'))?.id ?? 'account');
  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-small text-green">SETTINGS</p>
        <p className="font-serif text-title text-fg">Make yourself at home.</p>
        <p className="text-body text-muted">Your account and private library.</p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-8 px-3 py-2 text-label ${tab === t.id ? 'bg-green-bg text-green' : 'text-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'account' && <AccountTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'agents' && <AgentTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'opds' && <OpdsTab onCreateToken={() => setTab('agents')} />}
    </div>
  );
}
