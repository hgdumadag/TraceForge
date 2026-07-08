/** Theme state: follows the OS preference until the user makes an explicit choice. */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tf-theme";
const listeners = new Set<() => void>();

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let theme: Theme = initialTheme();
document.documentElement.dataset.theme = theme;

export function getTheme(): Theme {
  return theme;
}

export function toggleTheme(): void {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getTheme
  );
}
