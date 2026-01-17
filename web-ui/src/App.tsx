import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModsPage } from './pages/ModsPage';
import { ModEditorPage } from './pages/ModEditorPage';
import { GlossaryPage } from './pages/GlossaryPage';
import { DiffPage } from './pages/DiffPage';
import { EetImportsPage } from './pages/EetImportsPage';
import { CsvImportsPage } from './pages/CsvImportsPage';
import { ModImportsPage } from './pages/ModImportsPage';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const NAV_LINKS = [
  { to: '/', label: 'Mods', exact: true },
  { to: '/eet', label: 'EET Import', exact: false },
  { to: '/csv', label: 'CSV Import', exact: false },
  { to: '/mod-import', label: 'Mod Import', exact: false },
  { to: '/glossary', label: 'Glossary', exact: false },
  { to: '/diff', label: 'Diff', exact: false },
];

const Nav = () => {
  const loc = useLocation();
  return (
    <nav style={navStyles.nav}>
      <span style={navStyles.brand}>FO4 Localizer</span>
      {NAV_LINKS.map(({ to, label, exact }) => {
        const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
        return (
          <Link key={to} to={to} style={active ? navStyles.activeLink : navStyles.link}>
            {label}
          </Link>
        );
      })}
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
            <Route path="/eet" element={<EetImportsPage />} />
            <Route path="/csv" element={<CsvImportsPage />} />
            <Route path="/mod-import" element={<ModImportsPage />} />
            <Route path="/glossary" element={<GlossaryPage />} />
            <Route path="/diff" element={<DiffPage />} />
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

