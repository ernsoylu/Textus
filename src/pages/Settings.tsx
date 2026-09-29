import { useState, type FormEvent } from 'react';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { PasswordForm } from '@/components/account/PasswordForm';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "settings" and "opds": Account and OPDS tabs. (Appearance and Delete account are designed
// but not built: preferences have nothing to persist yet, and deleting an account needs a server function.)
const TABS = [
  { id: 'account', label: 'Account' },
  { id: 'opds', label: 'OPDS' },
] as const;

function AccountTab() {
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState<string>(session?.user.user_metadata?.display_name ?? '');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
    setProfileMessage(error ? error.message : 'Profile saved.');
  }

  return (
    <div className="flex flex-col gap-6">
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

      <div>
        <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function OpdsTab({ onSetPassword }: Readonly<{ onSetPassword: () => void }>) {
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
          <li>Sign in with your account email and password.</li>
        </ol>
      </div>
      <p className="text-small text-muted">
        Readers sign in with HTTP Basic, so an account that only uses magic links needs a password first.{' '}
        <button type="button" className="text-green underline" onClick={onSetPassword}>Set a password</button>
      </p>
    </div>
  );
}

export function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('account');
  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-small text-green">SETTINGS</p>
        <p className="font-serif text-title text-fg">Make yourself at home.</p>
        <p className="text-body text-muted">Your account and private library.</p>
      </div>
      <div role="tablist" className="flex gap-2">
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
      {tab === 'account' ? <AccountTab /> : <OpdsTab onSetPassword={() => setTab('account')} />}
    </div>
  );
}
