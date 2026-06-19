import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import './index.css';

// Vite fires this before React even mounts — handle stale chunks at the earliest point.
window.addEventListener('vite:preloadError', () => {
  const attempts = Number(sessionStorage.getItem('chunk_reload') || '0');
  if (attempts < 3) {
    sessionStorage.setItem('chunk_reload', String(attempts + 1));
    window.location.replace('/?_v=' + Date.now());
  }
});

// Clear the stale-chunk counter once JS actually executes successfully.
sessionStorage.removeItem('chunk_reload');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
