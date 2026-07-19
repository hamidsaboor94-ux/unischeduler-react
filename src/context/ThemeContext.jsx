import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

/** Dark is the app's default look — same as picking no `data-theme` at all, since :root's own
    values are already the dark palette (see style.css). Light is the explicit opt-in, remembered
    per-browser via localStorage (a device preference, not a per-account one like UI language). */
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') === 'light' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
