import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Login } from '@/pages/Login';
import { Overview } from '@/pages/Overview';
import { Library } from '@/pages/Library';
import { NewWork } from '@/pages/NewWork';
import { WorkDetail } from '@/pages/WorkDetail';
import { Collections } from '@/pages/Collections';
import { Contributors } from '@/pages/Contributors';
import { ContributorDetail } from '@/pages/ContributorDetail';
import { Notes } from '@/pages/Notes';
import { Placeholder } from '@/pages/Placeholder';

// pdfjs-dist alone is ~1MB — split out so the rest of the app doesn't pay for it upfront.
const Reader = lazy(() => import('@/pages/Reader').then((m) => ({ default: m.Reader })));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="library" element={<Library />} />
            <Route path="library/new" element={<NewWork />} />
            <Route path="library/:workId" element={<WorkDetail />} />
            <Route
              path="library/:workId/records/:recordId/assets/:assetId/read"
              element={
                <Suspense fallback={<p className="text-body text-muted">Loading reader…</p>}>
                  <Reader />
                </Suspense>
              }
            />
            <Route path="collections" element={<Collections />} />
            <Route path="contributors" element={<Contributors />} />
            <Route path="contributors/:contributorId" element={<ContributorDetail />} />
            <Route path="serials" element={<Placeholder title="Serials" />} />
            <Route path="notes" element={<Notes />} />
            <Route path="import" element={<Placeholder title="Import" />} />
            <Route path="activity" element={<Placeholder title="Activity" />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
