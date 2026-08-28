import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeChunk, saveSession, type LiveWindow } from "./voxguard";

const CHUNK_MS = 5000;

export type CallPhase = "idle" | "active" | "ended";

type State = {
  phase: CallPhase;
  analyzing: boolean;
  elapsed: number;
  windows: LiveWindow[];
  level: number;
  error: string | null;
};

/**
 * Drives a VoxGuard-controlled audio session: microphone audio is captured in
 * sequential 5-second windows and each window is posted to the backend.
 */
export function useLiveAnalysis() {
  const [state, setState] = useState<State>({
    phase: "idle",
    analyzing: true,
    elapsed: 0,
    windows: [],
    level: 0,
    error: null,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);
  const analyzingRef = useRef(true);
  const startedRef = useRef(0);

  const stopRecorder = useCallback(() => {
    if (cycleRef.current) clearTimeout(cycleRef.current);
    cycleRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const recordWindow = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !analyzingRef.current) return;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      setState((s) => ({ ...s, error: "Audio recording is not supported on this device." }));
      return;
    }
    recorderRef.current = recorder;
    const windowStart = (Date.now() - startedRef.current) / 1000;
    const parts: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(parts, { type: recorder.mimeType || "audio/webm" });
      if (analyzingRef.current) recordWindow();
      if (blob.size < 1024) return;
      const index = indexRef.current++;
      try {
        const result = await analyzeChunk(blob, `window-${index}.webm`);
        const entry: LiveWindow = {
          index,
          start: windowStart,
          end: windowStart + CHUNK_MS / 1000,
          aiProbability: result.probabilities.fake,
          result,
        };
        setState((s) => {
          const windows = [...s.windows, entry].sort((a, b) => a.index - b.index);
          saveSession({ startedAt: startedRef.current, windows });
          return { ...s, windows, error: null };
        });
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : "Analysis failed." }));
      }
    };

    recorder.start();
    cycleRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, CHUNK_MS);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / data.length) / 128;
      setState((s) => ({ ...s, level: Math.min(1, rms * 4) }));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startedRef.current = Date.now();
      indexRef.current = 0;
      analyzingRef.current = true;
      setState({ phase: "active", analyzing: true, elapsed: 0, windows: [], level: 0, error: null });
      timerRef.current = setInterval(() => {
        setState((s) => ({ ...s, elapsed: (Date.now() - startedRef.current) / 1000 }));
      }, 500);
      startMeter(stream);
      recordWindow();
    } catch {
      setState((s) => ({
        ...s,
        error: "Microphone access is required to run VoxGuard call protection.",
      }));
    }
  }, [recordWindow, startMeter]);

  const pauseAnalysis = useCallback(() => {
    analyzingRef.current = false;
    stopRecorder();
    setState((s) => ({ ...s, analyzing: false }));
  }, [stopRecorder]);

  const resumeAnalysis = useCallback(() => {
    analyzingRef.current = true;
    setState((s) => ({ ...s, analyzing: true }));
    recordWindow();
  }, [recordWindow]);

  const endCall = useCallback(() => {
    analyzingRef.current = false;
    stopRecorder();
    if (timerRef.current) clearInterval(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setState((s) => ({ ...s, phase: "ended", analyzing: false, level: 0 }));
  }, [stopRecorder]);

  useEffect(() => () => endCall(), [endCall]);

  return { ...state, startCall, pauseAnalysis, resumeAnalysis, endCall };
}
