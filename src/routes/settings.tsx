import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DEFAULT_API_URL, getApiUrl, setApiUrl } from "@/lib/voxguard";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Backend Settings — VoxGuard" },
      {
        name: "description",
        content:
          "Point the VoxGuard mobile app at your analysis backend and check the connection status.",
      },
      { property: "og:title", content: "Backend Settings — VoxGuard" },
      {
        property: "og:description",
        content: "Configure the VoxGuard analysis backend URL used for live chunk analysis.",
      },
    ],
  }),
  component: Settings,
});

function Settings() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => setUrl(getApiUrl()), []);

  const save = () => {
    setApiUrl(url);
    setStatus("Saved.");
  };

  const test = async () => {
    setChecking(true);
    setStatus(null);
    setApiUrl(url);
    try {
      const res = await fetch(`${getApiUrl()}/health`);
      setStatus(res.ok ? "Backend reachable." : `Backend responded with HTTP ${res.status}.`);
    } catch {
      setStatus("Could not reach the backend from this device.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
        <Link to="/" className="panel px-3 py-2 text-xs text-muted-foreground">
          Back
        </Link>
      </header>

      <section className="panel mt-5 px-4 py-5">
        <label className="label-mono" htmlFor="api">
          Analysis backend URL
        </label>
        <input
          id="api"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={DEFAULT_API_URL}
          className="mt-2 w-full rounded-md border border-input bg-secondary/50 px-3 py-3 font-mono text-sm outline-none focus:border-ring"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Your FastAPI server. Chunks are posted to <span className="font-mono">/api/analyze-chunk</span>.
          On a phone use your computer's LAN address (e.g. http://192.168.1.20:8000) and enable CORS.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={save}
            className="rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            Save
          </button>
          <button
            onClick={test}
            disabled={checking}
            className="rounded-full border border-border bg-secondary py-3 text-sm font-semibold text-secondary-foreground disabled:opacity-60"
          >
            {checking ? "Testing…" : "Test connection"}
          </button>
        </div>
        {status && <p className="mt-3 text-sm text-muted-foreground">{status}</p>}
      </section>

      <section className="panel mt-4 px-4 py-4 text-xs text-muted-foreground">
        <p className="label-mono mb-2">Install</p>
        Open the browser menu and choose “Add to Home screen” to install VoxGuard as a standalone
        mobile app.
      </section>
    </main>
  );
}
