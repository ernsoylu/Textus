import type { ReactNode } from 'react';

// Figma sign-in family (signin, signup, magic, forgot, reset): a brand panel on the left, the form
// on the right; below 768px the panel is dropped and the form fills the screen.
// The two sample covers are decoration from the design, not library data.
const SAMPLES = [
  { title: 'A Pattern Language', by: 'Christopher Alexander', tone: 'bg-green-bg' },
  { title: 'Ways of Seeing', by: 'John Berger', tone: 'bg-yellow-bg' },
];

export function AuthLayout({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: ReactNode }>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-[1000px] items-stretch gap-12">
        <aside aria-hidden="true" className="hidden w-[420px] shrink-0 flex-col justify-between gap-8 rounded-8 bg-dim p-8 md:flex">
          <div className="flex flex-col gap-6">
            <p className="font-serif text-title text-fg">textus</p>
            <p className="font-serif text-[40px] leading-[46px] text-fg">Keep what moves you.</p>
            <p className="text-body text-muted">A private place for your books, research and next great idea.</p>
            <div className="flex gap-4">
              {SAMPLES.map((s) => (
                <div key={s.title} className={`flex h-[230px] w-[150px] flex-col justify-between rounded-4 p-3 ${s.tone}`}>
                  <p className="text-[10px] text-muted">TEXTUS / LIBRARY</p>
                  <p className="text-body text-fg">{s.title}</p>
                  <p className="text-[10px] text-fg">{s.by}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="text-small text-green">YOUR LIBRARY. YOUR INFRASTRUCTURE.</p>
        </aside>
        <main className="flex w-full max-w-[424px] flex-col gap-4 self-start pt-2">
          <p className="font-serif text-title text-fg">{title}</p>
          <p className="text-body text-muted">{subtitle}</p>
          {children}
          <p className="text-small text-muted">Private by default. Only you can access your library.</p>
        </main>
      </div>
    </div>
  );
}
