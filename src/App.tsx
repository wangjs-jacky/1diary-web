import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { TimelinePage } from './feed/TimelinePage';
import { SyncProvider } from './sync/SyncContext';

const EditorPage = lazy(() => import('./editor/EditorPage').then((module) => ({ default: module.EditorPage })));
const library = () => import('./library/LibraryPages');
const DraftsPage = lazy(() => library().then((module) => ({ default: module.DraftsPage })));
const TrashPage = lazy(() => library().then((module) => ({ default: module.TrashPage })));
const CalendarPage = lazy(() => library().then((module) => ({ default: module.CalendarPage })));
const MemoriesPage = lazy(() => library().then((module) => ({ default: module.MemoriesPage })));

function SignedInApp() {
  const auth = useAuth();
  if (auth.loading) return <main className="center-page"><div className="loading-state">正在打开一本日记…</div></main>;
  if (!auth.session) return <LoginPage />;
  return (
    <SyncProvider>
      <HashRouter>
        <Suspense fallback={<div className="loading-state">正在打开…</div>}>
          <Routes>
            <Route path="/" element={<TimelinePage />} />
            <Route path="/new/:id" element={<EditorPage mode="new" />} />
            <Route path="/entry/:id" element={<EditorPage mode="edit" />} />
            <Route path="/drafts" element={<DraftsPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/memories" element={<MemoriesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </SyncProvider>
  );
}

export default function App() {
  return <AuthProvider><SignedInApp /></AuthProvider>;
}
