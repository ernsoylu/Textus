import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/hooks/useAuth';
import { App } from './App';
import { applyAppearance, loadAppearance } from '@/lib/appearance';
import './index.css';

applyAppearance(loadAppearance());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
