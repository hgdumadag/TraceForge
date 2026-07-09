/** Marketing-style entry screen shown at "#/", before the app shell. Full content lands in a follow-up task. */
export function LandingPage({ navigate }: { navigate: (h: string) => void }) {
  return (
    <div className="landing">
      <h1>TraceForge</h1>
      <button className="primary" onClick={() => navigate("#/workflows")}>Open Workflows</button>
    </div>
  );
}
