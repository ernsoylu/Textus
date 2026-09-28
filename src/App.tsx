import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Login } from '@/pages/Login';
import { Overview } from '@/pages/Overview';
import { Library } from '@/pages/Library';
import { NewWork } from '@/pages/NewWork';
import { WorkDetail } from '@/pages/WorkDetail';
import { Placeholder } from '@/pages/Placeholder';

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
            <Route path="collections" element={<Placeholder title="Collections" />} />
            <Route path="contributors" element={<Placeholder title="Contributors" />} />
            <Route path="serials" element={<Placeholder title="Serials" />} />
            <Route path="notes" element={<Placeholder title="Notes" />} />
            <Route path="import" element={<Placeholder title="Import" />} />
            <Route path="activity" element={<Placeholder title="Activity" />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
