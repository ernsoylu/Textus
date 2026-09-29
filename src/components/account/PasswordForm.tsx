import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-AUTH-1: set or change the password of the signed-in user. Used by Settings ("Change password")
// and by the recovery-link screen ("A fresh start."). The session proves who they are, so no current
// password is asked.
const passwordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' });

export function PasswordForm({ submitLabel, onSaved }: Readonly<{ submitLabel: string; onSaved?: () => void }>) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setFormError(null);
    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({ password: fields.password?.[0], confirm: fields.confirm?.[0] });
      return;
    }
    setErrors({});
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setFormError(error.message);
    setPassword('');
    setConfirm('');
    setSaved(true);
    onSaved?.();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-small text-fg">
        New password
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
      </label>
      <label className="flex flex-col gap-2 text-small text-fg">
        Confirm password
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
      </label>
      {formError && <p className="text-small text-red" role="alert">{formError}</p>}
      {saved && <output className="text-small text-green">Password saved. You can now sign in with your email and password.</output>}
      <div>
        <Button type="submit" isLoading={saving} disabled={!password || !confirm}>{submitLabel}</Button>
      </div>
    </form>
  );
}
