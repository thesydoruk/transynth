type NavIconName = 'sun' | 'moon' | 'log' | 'settings';

const PATHS: Record<NavIconName, string> = {
  sun: 'M8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-3v2M8 12.5v2M1.5 8h2M12.5 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4',
  moon: 'M12.2 10.4A5.2 5.2 0 0 1 5.6 3.8 5.4 5.4 0 1 0 12.2 10.4Z',
  log: 'M4 3.5h8v9H4zM6 6h4M6 8h4M6 10h2.5',
  settings:
    'M8 10.2A2.2 2.2 0 1 0 8 5.8a2.2 2.2 0 0 0 0 4.4ZM8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1',
};

/** Compact stroke icons for the top bar. */
export const NavIcon = ({ name }: { name: NavIconName }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d={PATHS[name]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
