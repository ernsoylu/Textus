import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { TopBar } from './TopBar';
import { UnsavedChangesProvider } from '@/components/ui/UnsavedChangesGuard';
import { useOnline } from '@/hooks/useOnline';

export function AppShell() {
  const online = useOnline();
  return (
    <UnsavedChangesProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {!online && (
            <p role="alert" className="bg-yellow-bg p-3 text-small text-yellow">
              You’re offline. Your library is shown as last loaded; changes can’t be saved until the connection returns.
            </p>
          )}
          <main className="flex-1 p-6 pb-24 md:pb-6">
            <Outlet />
          </main>
        </div>
        <MobileNav />
      </div>
    </UnsavedChangesProvider>
  );
}
