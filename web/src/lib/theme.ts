// Theme: 'light' | 'dark' | 'system'. Persisted in localStorage and applied by
// toggling the `dark` class on <html> (Tailwind darkMode: 'class').

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'troika_theme';

export function getTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'system';
}

function systemDark(): boolean {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

// Apply saved theme immediately (call once at startup) + react to OS changes.
export function initTheme() {
  applyTheme(getTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}
