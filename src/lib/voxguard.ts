/**
 * VoxGuard mobile domain layer.
 *
 * All HTTP communication with the FastAPI backend lives here — components and
 * routes must never call `fetch` directly.
 */

const API_KEY = "voxguard:apiUrl";

export const DEFAULT_API_URL: string =
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000";

export function getApiUrl(): string {
  try {
    return localStorage.getItem(API_KEY)?.trim() || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

export function setApiUrl(url: string): void {
  try {
    localStorage.setItem(API_KEY, url.trim().replace(/\/+$/, ""));
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ types */

export type Prediction = "real" | "fake";

export type F0Data = {
  time: number[];
  frequency: (number | null)[];
  mean: number;
  min: number;
  max: number;
  std: number;
  voiced_percent?: number;
};

export type MfccData = { data: number[][]; coefficients: number };
export type MelData = { data: number[][]; mel_bands: number };
export type AudioMeta = { duration: number; sample_rate: number };

export type AnalysisWindow = {
  index: number;
  start: number;
  end: number;
  prediction: Prediction;
  confidence: number;
  probabilities: { real: number; fake: number };
};

export type AnalysisResult = {
  success: boolean;
  error?: string;
  filename: string;
  prediction: Prediction;
  confidence: number;
  probabilities: { real: number; fake: number };
  audio?: AudioMeta;
  f0?: F0Data;
  mfcc?: MfccData;
  mel_spectrogram?: MelData;
  windows?: AnalysisWindow[];
};

/** One completed 5s live window on the mobile call screen. */
export type LiveWindow = {
  index: number;
  start: number;
  end: number;
  aiProbability: number;
  result: AnalysisResult;
};

/* -------------------------------------------------------------- risk model */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_THRESHOLDS: { level: RiskLevel; min: number; label: string }[] = [
  { level: "low", min: 0, label: "LOW RISK" },
  { level: "medium", min: 0.3, label: "MEDIUM RISK" },
  { level: "high", min: 0.6, label: "HIGH RISK" },
  { level: "critical", min: 0.85, label: "AI VOICE SUSPECTED" },
];

export function riskLevel(aiProbability: number): RiskLevel {
  let level: RiskLevel = "low";
  for (const entry of RISK_THRESHOLDS) if (aiProbability >= entry.min) level = entry.level;
  return level;
}

export function riskLabel(aiProbability: number): string {
  const level = riskLevel(aiProbability);
  return RISK_THRESHOLDS.find((entry) => entry.level === level)?.label ?? "LOW RISK";
}

export function riskColor(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "var(--risk-low)";
    case "medium":
      return "var(--risk-medium)";
    case "high":
      return "var(--risk-high)";
    case "critical":
      return "var(--risk-critical)";
  }
}

/** Overall risk: emphasises the sustained signal, not one spike. */
export function overallRisk(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const peak = Math.max(...values);
  return mean * 0.7 + peak * 0.3;
}

/* ----------------------------------------------------------------- format */

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/* -------------------------------------------------------------------- api */

async function postAudio(path: string, file: Blob, filename: string): Promise<AnalysisResult> {
  const base = getApiUrl();
  const body = new FormData();
  body.append("file", file, filename);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method: "POST", body });
  } catch {
    throw new Error(`Cannot reach the analysis backend at ${base}.`);
  }

  let payload: Partial<AnalysisResult> | null = null;
  try {
    payload = (await response.json()) as Partial<AnalysisResult>;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || payload.success === false) {
    throw new Error(payload?.error || `Analysis failed (HTTP ${response.status}).`);
  }
  if (typeof payload.confidence !== "number" || !payload.probabilities || !payload.prediction) {
    throw new Error("The backend response is missing detection fields.");
  }

  return { ...(payload as AnalysisResult), success: true, filename: payload.filename ?? filename };
}

/** Analyze a complete recording. */
export function analyzeAudio(file: File): Promise<AnalysisResult> {
  return postAudio("/api/analyze", file, file.name);
}

/** Analyze a single short chunk of a live VoxGuard call. */
export function analyzeChunk(chunk: Blob, filename = "chunk.webm"): Promise<AnalysisResult> {
  return postAudio("/api/analyze-chunk", chunk, filename);
}

/* ---------------------------------------------------------------- storage */

const SESSION_KEY = "voxguard:session";

export type StoredSession = {
  startedAt: number;
  windows: LiveWindow[];
};

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}
