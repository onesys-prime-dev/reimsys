import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/public-sans/index.css';
import './styles.css';
import { installNumberGuard } from './numberGuard';
import { errMsg } from './api';
import { ToastProvider, toastOutside } from './ui';

installNumberGuard();

/** Safety net: an action with no error handler of its own still tells the person it failed. (A 401 is left to the session guard.) */
const mutationCache = new MutationCache({
  onError: (e, _v, _c, mutation) => { if (!mutation.options.onError && (e as { status?: number }).status !== 401) toastOutside(errMsg(e)); },
});
const client = new QueryClient({ mutationCache, defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
