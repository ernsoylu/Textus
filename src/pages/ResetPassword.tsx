import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout } from '@/components/account/AuthLayout';
import { PasswordForm } from '@/components/account/PasswordForm';

// FR-AUTH-1: destination of the recovery link. supabase-js turns the link's token into a session
// (AuthProvider), so a session here means the link was valid.
export function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <AuthLayout title="A fresh start." subtitle="Checking your link…">{null}</AuthLayout>;
  if (!session) {
    return (
      <AuthLayout title="This link has expired." subtitle="Recovery links work once and expire after an hour.">
        <Link to="/forgot" className="text-small text-green underline">Send a new recovery link</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="A fresh start." subtitle="Choose a new password for your account.">
      <PasswordForm submitLabel="Save new password" onSaved={() => setTimeout(() => navigate('/'), 1200)} />
      <Link to="/login" className="text-center text-small text-muted underline">Back to sign in</Link>
    </AuthLayout>
  );
}
