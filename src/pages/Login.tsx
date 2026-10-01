import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase, turnstileSiteKey } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout } from '@/components/account/AuthLayout';
import { Turnstile } from '@/components/account/Turnstile';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-AUTH-1: email/password and magic link (Figma signin, magic). OAuth is configured server-side per
// provider and deferred until release planning, so there is no provider button. Public sign-up is closed
// (Auth DISABLE_SIGNUP); the owner creates accounts. Auth requires a Turnstile token when a site key is set.
const emailSchema = z.string().email('Enter a valid email address.');
const CAPTCHA_REQUIRED = 'Complete the security check.';

export function Login() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [magicSentTo, setMagicSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const captchaMissing = Boolean(turnstileSiteKey) && !captchaToken;
  const options = captchaToken ? { captchaToken } : {};

  async function sendMagicLink() {
    setFormError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setErrors({ email: parsed.error.issues[0]?.message });
    setErrors({});
    if (captchaMissing) return setFormError(CAPTCHA_REQUIRED);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: globalThis.location.origin, shouldCreateUser: false, ...options } });
    setLoading(false);
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    if (error) setFormError(error.message);
    else setMagicSentTo(email);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const emailResult = emailSchema.safeParse(email);
    const passwordResult = z.string().min(1, 'Enter your password.').safeParse(password);
    if (!emailResult.success || !passwordResult.success) {
      setErrors({ email: emailResult.error?.issues[0]?.message, password: passwordResult.error?.issues[0]?.message });
      return;
    }
    setErrors({});
    if (captchaMissing) return setFormError(CAPTCHA_REQUIRED);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password, options });
    setLoading(false);
    setCaptchaToken(null);
    setCaptchaReset((n) => n + 1);
    if (error) setFormError(error.message);
  }

  // Signing in (or arriving with a session) leaves this screen for the app.
  if (session) return <Navigate to="/" replace />;

  if (magicSentTo) {
    return (
      <AuthLayout title="Check your inbox." subtitle={`We sent a sign-in link to ${magicSentTo}.`}>
        <p className="rounded-8 bg-green-bg p-3 text-small text-fg">Open the email on this device to continue.</p>
        {turnstileSiteKey && <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />}
        {formError && <p className="text-small text-red" role="alert">{formError}</p>}
        <Button variant="secondary" isLoading={loading} onClick={sendMagicLink}>Resend link</Button>
        <button type="button" className="text-center text-small text-fg underline" onClick={() => setMagicSentTo(null)}>Use a different email</button>
        <p className="text-small text-muted">Link expired? Request a new one above.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back." subtitle="Your library is right where you left it.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-2 text-small text-fg">
          Email address
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        </label>
        <label className="flex flex-col gap-2 text-small text-fg">
          Password
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        </label>
        {turnstileSiteKey && <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />}
        {formError && <p className="text-small text-red" role="alert">{formError}</p>}
        <Button type="submit" isLoading={loading}>Sign in</Button>
      </form>
      <Link to="/forgot" className="text-center text-small text-fg underline">Forgot password?</Link>
      <hr className="border-border" />
      <Button variant="secondary" isLoading={loading} onClick={sendMagicLink}>Email me a sign-in link</Button>
    </AuthLayout>
  );
}
