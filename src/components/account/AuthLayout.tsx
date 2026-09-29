import type { ReactNode } from 'react';

// Centered card for the signed-out account screens (forgot / reset password), Figma "forgot" and "reset".
export function AuthLayout({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: ReactNode }>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-[424px] flex-col gap-4">
        <p className="font-serif text-title text-fg">{title}</p>
        <p className="text-body text-muted">{subtitle}</p>
        {children}
        <p className="text-small text-muted">Private by default. Only you can access your library.</p>
      </div>
    </div>
  );
}
