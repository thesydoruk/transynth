import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastHost } from './components/Toast';
import { AppShell } from './AppShell';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

export const App = () => {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AppShell />
        <ToastHost />
      </BrowserRouter>
    </QueryClientProvider>
  );
};
