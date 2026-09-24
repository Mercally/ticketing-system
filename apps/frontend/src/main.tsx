import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.tsx';

// One QueryClient instance for the whole app. Deliberate, non-default choices for
// this demo: no refetch-on-window-focus (polling for order status is explicit and
// short-interval already; we don't want every alt-tab to also trigger a refetch
// storm), one retry (not the default 3 — failures should surface quickly in a demo
// meant to showcase resilience/compensation, not hide behind silent retries).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
