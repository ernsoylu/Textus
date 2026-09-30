import { Suspense, lazy } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
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
import { Serials } from '@/pages/Serials';
import { Import } from '@/pages/Import';
import { ForgotPassword } from '@/pages/ForgotPassword';
import { ResetPassword } from '@/pages/ResetPassword';
import { NotFound } from '@/pages/NotFound';
import { Tags } from '@/pages/Tags';
import { CollectionDetail } from '@/pages/CollectionDetail';
import { SerialDetail } from '@/pages/SerialDetail';
import { Settings } from '@/pages/Settings';
import { Activity } from '@/pages/Activity';

// pdfjs-dist alone is ~1MB — split out so the rest of the app doesn't pay for it upfront.
const Reader = lazy(() => import('@/pages/Reader').then((m) => ({ default: m.Reader })));

// A data router (not <BrowserRouter>) so screens with unsaved edits can block navigation (useBlocker).
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
    <Route path="/login" element={<Login />} />
    <Route path="/forgot" element={<ForgotPassword />} />
    <Route path="/reset" element={<ResetPassword />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="library" element={<Library />} />
        <Route path="library/new" element={<NewWork />} />
        <Route path="library/:workId" element={<WorkDetail />} />
        <Route path="library/:workId/edit" element={<WorkDetail />} />
        <Route
          path="library/:workId/records/:recordId/assets/:assetId/read"
          element={
            <Suspense fallback={<p className="text-body text-muted">Loading reader…</p>}>
              <Reader />
            </Suspense>
          }
        />
        <Route path="collections" element={<Collections />} />
        <Route path="collections/:collectionId" element={<CollectionDetail />} />
        <Route path="tags" element={<Tags />} />
        <Route path="contributors" element={<Contributors />} />
        <Route path="contributors/:contributorId" element={<ContributorDetail />} />
        <Route path="serials" element={<Serials />} />
        <Route path="serials/:workId" element={<SerialDetail />} />
        <Route path="notes" element={<Notes />} />
        <Route path="import" element={<Import />} />
        <Route path="activity" element={<Activity />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
      </>,
  ),
);

export function App() {
  return <RouterProvider router={router} />;
}
