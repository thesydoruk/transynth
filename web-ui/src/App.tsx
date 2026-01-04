import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModsPage } from './pages/ModsPage';
import { ModEditorPage } from './pages/ModEditorPage';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function Nav() {
  const loc = useLocation();
  return (
    <nav style={navStyles.nav}>
      <span style={navStyles.brand}>FO4 Localizer</span>
      <Link to="/" style={loc.pathname === '/' ? navStyles.activeLink : navStyles.link}>
        Mods
      </Link>
    </nav>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Nav />
        <main style={{ minHeight: 'calc(100vh - 48px)' }}>
          <Routes>
            <Route path="/" element={<ModsPage />} />
            <Route path="/mods/:id" element={<ModEditorPage />} />
          </Routes>
        </main>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const navStyles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '0 24px',
    height: 48,
    background: '#111',
    borderBottom: '1px solid #2a2a2a',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  brand: { fontWeight: 700, fontSize: 16, color: '#d4a843', marginRight: 12 },
  link: { color: '#aaa', textDecoration: 'none', fontSize: 14 },
  activeLink: { color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600 },
};

