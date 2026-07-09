import { useTheme, toggleTheme } from "./theme";

/** Light/dark switch. Shared by the app sidebar (App.tsx) and the landing page nav. */
export function ThemeToggle({ className = "sidebar-toggle theme-toggle" }: { className?: string } = {}) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className={className}
      onClick={toggleTheme}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
