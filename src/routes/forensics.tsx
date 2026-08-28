import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  formatPercent,
  formatTime,
  loadSession,
  overallRisk,
  riskColor,
  riskLabel,
  riskLevel,
  type LiveWindow,
} from "@/lib/voxguard";

export const Route = createFileRoute("/forensics")({
  head: () => ({
    meta: [
      { title: "Forensic Analysis — VoxGuard" },
      {
        name: "description",
        content:
          "Per-window forensic detail from your VoxGuard call: F0, pitch statistics, MFCC and mel spectrogram signatures.",
      },
      { property: "og:title", content: "Forensic Analysis — VoxGuard" },
      {
        property: "og:description",
        content: "Detailed per-window voice forensics from your last VoxGuard call.",
      },
    ],
  }),
  component: Forensics,
});

function Heat({ rows, label }: { rows: number[][]; label: string }) {
  const flat = rows.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;
  return (
    <div>
      <p className="label-mono mb-2">{label}</p>
      <div className="overflow-hidden rounded-md border border-border">
        {rows.slice(0, 24).map((row, i) => (
          <div key={i} className="flex h-2">
            {row.slice(0, 96).map((v, j) => (
              <span
                key={j}
                className="flex-1"
                style={{
                  background: `color-mix(in oklab, var(--color-primary) ${Math.round(((v - min) / span) * 100)}%, var(--color-card))`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WindowCard({ w }: { w: LiveWindow }) {
  const [open, setOpen] = useState(false);
  const color = riskColor(riskLevel(w.aiProbability));
  const f0 = w.result.f0;

  return (
    <li className="panel px-4 py-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 text-left">
        <span className="font-mono text-xs text-muted-foreground">
          {formatTime(w.start)}–{formatTime(w.end)}
        </span>
        <span className="flex-1 text-sm font-medium" style={{ color }}>
          {riskLabel(w.aiProbability)}
        </span>
        <span className="font-mono text-sm" style={{ color }}>
          {formatPercent(w.aiProbability, 0)}
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Prediction" value={w.result.prediction.toUpperCase()} />
            <Stat label="Confidence" value={formatPercent(w.result.confidence, 1)} />
            {f0 && <Stat label="F0 mean" value={`${f0.mean.toFixed(1)} Hz`} />}
            {f0 && <Stat label="F0 std" value={`${f0.std.toFixed(1)} Hz`} />}
            {f0 && <Stat label="F0 range" value={`${f0.min.toFixed(0)}–${f0.max.toFixed(0)} Hz`} />}
            {f0?.voiced_percent !== undefined && (
              <Stat label="Voiced" value={`${f0.voiced_percent.toFixed(0)}%`} />
            )}
            {w.result.audio && (
              <Stat label="Sample rate" value={`${w.result.audio.sample_rate} Hz`} />
            )}
          </div>
          {w.result.mfcc && <Heat rows={w.result.mfcc.data} label="MFCC" />}
          {w.result.mel_spectrogram && (
            <Heat rows={w.result.mel_spectrogram.data} label="Mel spectrogram" />
          )}
        </div>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-secondary/40 px-3 py-2">
      <p className="label-mono">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  );
}

function Forensics() {
  const [windows, setWindows] = useState<LiveWindow[]>([]);

  useEffect(() => {
    setWindows(loadSession()?.windows ?? []);
  }, []);

  const overall = overallRisk(windows.map((w) => w.aiProbability));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Forensic analysis</h1>
        <Link to="/" className="panel px-3 py-2 text-xs text-muted-foreground">
          Back
        </Link>
      </header>

      <section className="panel mt-5 px-4 py-4">
        <p className="label-mono">Session risk</p>
        <p
          className="font-mono text-3xl"
          style={{ color: overall === null ? undefined : riskColor(riskLevel(overall)) }}
        >
          {overall === null ? "--" : formatPercent(overall, 0)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {windows.length} analyzed window{windows.length === 1 ? "" : "s"} · weighted 70% sustained,
          30% peak
        </p>
      </section>

      <ul className="mt-5 flex flex-col gap-2">
        {windows.length === 0 && (
          <li className="panel px-4 py-6 text-center text-sm text-muted-foreground">
            No analyzed windows yet. Start a protected call to collect forensic data.
          </li>
        )}
        {windows.map((w) => (
          <WindowCard key={w.index} w={w} />
        ))}
      </ul>
    </main>
  );
}
