import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase, turnstileSiteKey } from '@/lib/supabase';
import { AuthLayout } from '@/components/account/AuthLayout';
import { Turnstile } from '@/components/account/Turnstile';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-AUTH-1: request a recovery link. The link signs the user in and lands on /reset.
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = z.string().email('Enter a valid email address.').safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
    if (turnstileSiteKey && !captchaToken) return setError('Complete the security check.');
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${globalThis.location.origin}/reset`, ...(captchaToken ? { captchaToken } : {}) });
    setLoading(false);
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    if (resetError) return setError(resetError.message);
    setSent(true);
  }

  return (
    <AuthLayout title="Reset your password." subtitle="Enter your email and we’ll send a recovery link.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-small text-fg">
          Email address
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error ?? undefined} />
        </label>
        {turnstileSiteKey && <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />}
        {sent && <output className="text-small text-green">If that address has an account, a recovery link is on its way.</output>}
        <Button type="submit" isLoading={loading}>Send recovery link</Button>
      </form>
      <Link to="/login" className="text-center text-small text-muted underline">Back to sign in</Link>
    </AuthLayout>
  );
}
