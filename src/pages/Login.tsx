import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { newPasswordSchema } from '@/lib/passwordRules';
import { AuthLayout } from '@/components/account/AuthLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-AUTH-1: email/password and magic link (Figma signin, signup, magic). OAuth is configured
// server-side per provider and deferred until release planning, so there is no provider button.
type Mode = 'sign_in' | 'sign_up';
const emailSchema = z.string().email('Enter a valid email address.');
const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  sign_in: { title: 'Welcome back.', subtitle: 'Your library is right where you left it.', submit: 'Sign in' },
  sign_up: { title: 'Start your library.', subtitle: 'A private home for everything you read.', submit: 'Create account' },
};

export function Login() {
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = COPY[mode];

  async function sendMagicLink() {
    setFormError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setErrors({ email: parsed.error.issues[0]?.message });
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: globalThis.location.origin } });
    setLoading(false);
    if (error) setFormError(error.message);
    else setMagicSentTo(email);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const emailResult = emailSchema.safeParse(email);
    const passwordResult = mode === 'sign_up' ? newPasswordSchema.safeParse(password) : z.string().min(1, 'Enter your password.').safeParse(password);
    if (!emailResult.success || !passwordResult.success) {
      setErrors({ email: emailResult.error?.issues[0]?.message, password: passwordResult.error?.issues[0]?.message });
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = mode === 'sign_in' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setFormError(error.message);
  }

  // Signing in (or arriving with a session) leaves this screen for the app.
  if (session) return <Navigate to="/" replace />;

  if (magicSentTo) {
    return (
      <AuthLayout title="Check your inbox." subtitle={`We sent a sign-in link to ${magicSentTo}.`}>
        <p className="rounded-8 bg-green-bg p-3 text-small text-fg">Open the email on this device to continue.</p>
        {formError && <p className="text-small text-red" role="alert">{formError}</p>}
        <Button variant="secondary" isLoading={loading} onClick={sendMagicLink}>Resend link</Button>
        <button type="button" className="text-center text-small text-fg underline" onClick={() => setMagicSentTo(null)}>Use a different email</button>
        <p className="text-small text-muted">Link expired? Request a new one above.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-2 text-small text-fg">
          Email address
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        </label>
        <label className="flex flex-col gap-2 text-small text-fg">
          Password
          <Input id="password" type="password" autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          {mode === 'sign_up' && !errors.password && <span className="text-small text-muted">Use at least 12 characters.</span>}
        </label>
        {formError && <p className="text-small text-red" role="alert">{formError}</p>}
        <Button type="submit" isLoading={loading}>{copy.submit}</Button>
      </form>
      {mode === 'sign_in' ? (
        <>
          <Link to="/forgot" className="text-center text-small text-fg underline">Forgot password?</Link>
          <hr className="border-border" />
          <Button variant="secondary" isLoading={loading} onClick={sendMagicLink}>Email me a sign-in link</Button>
          <button type="button" className="text-center text-small text-fg underline" onClick={() => setMode('sign_up')}>New here? Create an account</button>
        </>
      ) : (
        <button type="button" className="text-center text-small text-fg underline" onClick={() => setMode('sign_in')}>Back to sign in</button>
      )}
    </AuthLayout>
  );
}
