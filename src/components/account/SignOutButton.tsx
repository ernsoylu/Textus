import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';

// Figma "signout": "See you on the next page." — confirms before ending the session on this device.
export function SignOutButton({ variant = 'secondary' }: Readonly<{ variant?: 'secondary' | 'ghost' }>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>Sign out</Button>
      <ConfirmDialog
        open={open}
        title="See you on the next page."
        description="Sign out of Textus on this device?"
        confirmLabel="Sign out"
        cancelLabel="Stay here"
        danger={false}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await supabase.auth.signOut();
          setBusy(false);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
