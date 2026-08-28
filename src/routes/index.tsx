import { createFileRoute, Link } from "@tanstack/react-router";
import { RiskDial } from "@/components/RiskDial";
import { useLiveAnalysis } from "@/lib/useLiveAnalysis";
import { formatPercent, formatTime, overallRisk, riskColor, riskLevel } from "@/lib/voxguard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoxGuard — Live Call Deepfake Shield" },
      {
        name: "description",
        content:
          "Run a VoxGuard-protected call and see AI voice probability update every 5 seconds, with full forensic detail.",
      },
      { property: "og:title", content: "VoxGuard — Live Call Deepfake Shield" },
      {
        property: "og:description",
        content: "Live AI voice detection on every 5-second window of your call.",
      },
    ],
  }),
  component: CallScreen,
});

function CallScreen() {
  const call = useLiveAnalysis();
  const values = call.windows.map((w) => w.aiProbability);
  const latest = values.length ? values[values.length - 1]! : null;
  const overall = overallRisk(values);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">VoxGuard</h1>
          <p className="label-mono">Voice deepfake shield</p>
        </div>
        <Link
          to="/settings"
          className="panel px-3 py-2 text-xs font-medium text-muted-foreground"
        >
          Settings
        </Link>
      </header>

      <section className="panel mt-6 px-5 py-6">
        <div className="flex items-center justify-between">
          <span className="label-mono">
            {call.phase === "active" ? "Call active" : call.phase === "ended" ? "Call ended" : "Ready"}
          </span>
          <span className="font-mono text-sm text-muted-foreground">{formatTime(call.elapsed)}</span>
        </div>

        <div className="mt-4">
          <RiskDial value={latest} active={call.phase === "active" && call.analyzing} level={call.level} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-center">
          <div className="panel px-3 py-3">
            <p className="label-mono">Windows</p>
            <p className="font-mono text-lg">{call.windows.length}</p>
          </div>
          <div className="panel px-3 py-3">
            <p className="label-mono">Overall risk</p>
            <p
              className="font-mono text-lg"
              style={{ color: overall === null ? undefined : riskColor(riskLevel(overall)) }}
            >
              {overall === null ? "--" : formatPercent(overall, 0)}
            </p>
          </div>
        </div>

        {!call.analyzing && call.phase === "active" && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Analysis paused — the call continues normally.
          </p>
        )}
        {call.error && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {call.error}
          </p>
        )}
      </section>

      <section className="mt-5 flex flex-col gap-3">
        {call.phase !== "active" ? (
          <button
            onClick={call.startCall}
            className="rounded-full bg-primary py-4 text-base font-semibold text-primary-foreground active:scale-[0.98]"
          >
            {call.phase === "ended" ? "Start new protected call" : "Start protected call"}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={call.analyzing ? call.pauseAnalysis : call.resumeAnalysis}
              className="rounded-full border border-border bg-secondary py-4 text-sm font-semibold text-secondary-foreground active:scale-[0.98]"
            >
              {call.analyzing ? "Stop analysis" : "Resume analysis"}
            </button>
            <button
              onClick={call.endCall}
              className="rounded-full bg-destructive py-4 text-sm font-semibold text-destructive-foreground active:scale-[0.98]"
            >
              End call
            </button>
          </div>
        )}
        <Link
          to="/forensics"
          className="panel py-3 text-center text-sm font-medium text-foreground"
        >
          Forensic details
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="label-mono mb-2">Rolling windows</h2>
        <ul className="flex flex-col gap-2">
          {call.windows.length === 0 && (
            <li className="panel px-4 py-4 text-sm text-muted-foreground">
              The first result appears after the first 5-second window is analyzed.
            </li>
          )}
          {[...call.windows].reverse().map((w) => {
            const color = riskColor(riskLevel(w.aiProbability));
            return (
              <li key={w.index} className="panel flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTime(w.start)}–{formatTime(w.end)}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${w.aiProbability * 100}%`, background: color }}
                  />
                </div>
                <span className="font-mono text-sm" style={{ color }}>
                  {formatPercent(w.aiProbability, 0)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
