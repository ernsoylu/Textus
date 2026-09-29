import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-AUTH-1: email/password and magic link. OAuth is configured server-side per provider
// and not wired up yet (needs client IDs/secrets — see CREDENTIALS.md follow-up).
const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

const SUBMIT_LABEL = { sign_in: 'Sign in', sign_up: 'Create account', magic_link: 'Send magic link' } as const;

export function Login() {
  const [mode, setMode] = useState<'sign_in' | 'sign_up' | 'magic_link'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setMagicLinkSent(false);

    if (mode === 'magic_link') {
      const parsed = z.string().email('Enter a valid email address.').safeParse(email);
      if (!parsed.success) {
        setErrors({ email: parsed.error.issues[0]?.message });
        return;
      }
      setErrors({});
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({ email });
      setLoading(false);
      if (error) setFormError(error.message);
      else setMagicLinkSent(true);
      return;
    }

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path[0] as 'email' | 'password'] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } =
      mode === 'sign_in'
        ? await supabase.auth.signInWithPassword(parsed.data)
        : await supabase.auth.signUp(parsed.data);
    setLoading(false);
    if (error) setFormError(error.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[424px] flex-col gap-4">
        <p className="font-serif text-title text-fg">textus</p>
        <p className="text-body text-muted">Your private library.</p>

        <Input
          id="email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        {mode !== 'magic_link' && (
          <Input
            id="password"
            type="password"
            placeholder="Password"
            autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
        )}

        {mode === 'sign_in' && <Link to="/forgot" className="text-small text-muted underline">Forgot password?</Link>}
        {formError && <p className="text-small text-red">{formError}</p>}
        {magicLinkSent && <p className="text-small text-green">Check your email for a sign-in link.</p>}

        <Button type="submit" isLoading={loading}>
          {loading ? 'Working…' : SUBMIT_LABEL[mode]}
        </Button>

        <div className="flex justify-between text-small text-muted">
          <button
            type="button"
            className="underline"
            onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
          >
            {mode === 'sign_in' ? 'Need an account?' : 'Have an account? Sign in'}
          </button>
          <button type="button" className="underline" onClick={() => setMode('magic_link')}>
            Use a magic link
          </button>
        </div>
      </form>
    </div>
  );
}
