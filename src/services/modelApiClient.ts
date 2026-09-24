/**
 * Client for the Vaani Kavach detection service (AASIST anti-spoofing,
 * model aasist_multigen5, ONNX Runtime on CPU).
 *
 * Requests go straight to the deployed detector, which sends CORS headers for
 * any origin: no proxy, no rewrite rule and no key in the browser, so the page
 * works wherever it is hosted. Set NEXT_PUBLIC_VAANI_API_URL to point at
 * another deployment (a local uvicorn, say).
 *
 * Nothing here fabricates a verdict: every field comes from the service, and
 * `exchanges` keeps the exact JSON that went over the wire.
 */

export type Verdict = "HUMAN" | "UNCERTAIN" | "AI_SPOOF";
export type Action = "ALLOW" | "VERIFY" | "BLOCK";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskReceipt {
  receipt_id: string;
  issued_at: number;
  expires_at: number;
  session_id: string;
  action: Action;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  classification: Verdict;
  model_version: string;
  spoof_score: number | null;
  confidence: number;
  audio_quality: string;
  signature: string;
}

export interface InferenceResult {
  /** 1 − spoof probability, 0..1. Undefined when the audio failed the quality gate. */
  authenticityScore?: number;
  /** 1 − model confidence, 0..1. */
  uncertainty?: number;
  evidence?: string[];
  latencyMs?: number;
  status: "pending" | "processing" | "completed" | "error" | "not_connected";
  error?: string;

  verdict?: Verdict;
  action?: Action;
  riskScore?: number;
  riskLevel?: RiskLevel;
  audioQuality?: string;
  /** Per-window risk, 1.5 s windows at 1 s hop, display only. */
  timeline?: { t: number; risk: number }[];
  /** HMAC-signed receipt; absent when the service has no RECEIPT_SECRET. */
  receipt?: RiskReceipt;
}

export interface ServiceHealth {
  status: "healthy" | "unhealthy";
  model_version?: string;
  model_load_ms?: number;
  calibrated?: boolean;
  spoof_calibrated?: boolean;
  receipts_enabled?: boolean;
  reason?: string;
}

export interface AuthorizeResult {
  decision: "ALLOW" | "STEP_UP";
  risk_level: RiskLevel;
  final_risk: number;
  voice_risk: number;
  voice_verified: boolean;
  context_risk: number;
  context_reasons: string[];
  step_up_methods: string[];
  note?: string;
}

export interface Exchange {
  at: string;
  method: "GET" | "POST";
  path: string;
  request: unknown;
  status: number;
  response: unknown;
  ms: number;
}

const BASE = (process.env.NEXT_PUBLIC_VAANI_API_URL ?? "https://vaani-kavach-five.vercel.app").replace(/\/$/, "");
/** /health sits at the root; everything else is under /api/v1. */
const url = (path: string) => BASE + (path === "/health" ? path : "/api/v1" + path);
/** Longest clip sent to the detector, seconds. Same cap as the reference UI. */
const MAX_SECONDS = 20;
const SAMPLE_RATE = 16000;
/** 20 s of 16 kHz mono WAV is 640 KB; the slack covers other formats. */
const MAX_UPLOAD_BYTES = 4_000_000;

/** Last requests and responses, newest first. Read by the API Exchange tab. */
export const exchanges: Exchange[] = [];
const listeners = new Set<() => void>();
export function onExchange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function call<T>(method: "GET" | "POST", path: string, body?: FormData | object): Promise<{ status: number; data: T }> {
  const t0 = performance.now();
  const init: RequestInit = { method };
  let shown: unknown = null;
  if (body instanceof FormData) {
    init.body = body;
    const f = body.get("audio") as File | null;
    shown = { multipart: { audio: f ? `${f.name} (${f.size} bytes, ${f.type || "audio"})` : null } };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
    shown = body;
  }
  const res = await fetch(url(path), init);
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { detail: text.slice(0, 300) }; }
  exchanges.unshift({ at: new Date().toISOString(), method, path: path === "/health" ? path : "/api/v1" + path, request: shown,
    status: res.status, response: data, ms: Math.round(performance.now() - t0) });
  exchanges.splice(20);
  listeners.forEach(fn => fn());
  return { status: res.status, data: data as T };
}

export async function getHealth(): Promise<ServiceHealth> {
  try {
    const { data } = await call<ServiceHealth>("GET", "/health");
    return data;
  } catch {
    return { status: "unhealthy", reason: "cannot reach the detector" };
  }
}

interface DetectResponse {
  status: string;
  classification: Verdict;
  action: Action;
  action_reason: string;
  risk_score: number;
  risk_level: RiskLevel;
  spoof_score: number | null;
  confidence: number;
  audio_quality: string;
  timeline: { t: number; risk: number }[];
  signals: string[];
  processing_time_ms: number;
  receipt?: RiskReceipt;
  reason?: string;
  detail?: string;
}

export async function analyzeAudio(audioFile: File | Blob): Promise<InferenceResult> {
  let upload: Blob = audioFile;
  let name = audioFile instanceof File ? audioFile.name : "recording.wav";
  // Decode in the browser when we can: M4A/AAC/WebM never reach the server's
  // decoder, and every clip goes up as the same 16 kHz mono WAV the recorder makes.
  try {
    upload = await toWav16k(audioFile);
    name = name.replace(/\.[^.]+$/, "") + ".wav";
  } catch {
    // The server decodes WAV/MP3/FLAC/OGG itself, so the original bytes are
    // still worth sending — but nothing has trimmed them to MAX_SECONDS, and
    // only the byte cap below stands between a long upload and the detector.
    if (upload.size > MAX_UPLOAD_BYTES) {
      return { status: "error", error: `This file could not be decoded here and is too large to send as is — trim it to about ${MAX_SECONDS} seconds, or use WAV or MP3.` };
    }
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return { status: "error", error: `Clip too large — keep it under ${MAX_SECONDS} seconds.` };
  }
  const form = new FormData();
  form.append("audio", upload, name);
  let status: number, data: DetectResponse;
  try {
    ({ status, data } = await call<DetectResponse>("POST", "/voice/detect", form));
  } catch {
    return { status: "not_connected", error: "Could not reach the detector. Check your connection and try again." };
  }
  if (status !== 200 || data.status !== "success") {
    const detail = data.detail || data.reason || `HTTP ${status}`;
    return { status: status === 422 ? "error" : "not_connected", error: detail };
  }
  const evidence = [data.action_reason, ...(data.reason ? [data.reason] : []), ...data.signals.map(s => `signal: ${s}`)];
  return {
    status: "completed",
    authenticityScore: data.spoof_score == null ? undefined : 1 - data.spoof_score,
    uncertainty: 1 - data.confidence,
    evidence,
    latencyMs: data.processing_time_ms,
    verdict: data.classification,
    action: data.action,
    riskScore: data.risk_score,
    riskLevel: data.risk_level,
    audioQuality: data.audio_quality,
    timeline: data.timeline,
    receipt: data.receipt,
  };
}

export async function verifyReceipt(receipt: unknown): Promise<{ valid: boolean; reason: string }> {
  const { status, data } = await call<{ valid?: boolean; reason?: string; detail?: string }>(
    "POST", "/receipt/verify", receipt as object);
  if (status !== 200 || typeof data?.valid !== "boolean") {
    return { valid: false, reason: data?.detail || `verification failed: HTTP ${status}` };
  }
  return { valid: data.valid, reason: data.reason ?? "" };
}

export async function authorizeAction(body: {
  receipt: RiskReceipt | null; amount: number; contact_status: "known" | "unknown"; first_payee: boolean;
}): Promise<AuthorizeResult> {
  const { status, data } = await call<AuthorizeResult & { detail?: string }>("POST", "/action/authorize", body);
  // A 4xx/5xx body has no decision in it. Rendering it would show an empty
  // verdict where the page promises one, so fail loudly instead.
  if (status !== 200 || !data?.decision) {
    throw new Error(data?.detail || `authorization failed: HTTP ${status}`);
  }
  return data;
}

// ---- audio capture --------------------------------------------------------

export interface Recorder { stop(): Promise<Blob>; }

/**
 * Web Audio capture rather than MediaRecorder: MediaRecorder emits webm/opus,
 * which the server cannot decode. Captures float PCM at the device's native
 * rate (some Android builds refuse a 16 kHz context) and resamples on stop.
 * Calls `onCap` once MAX_SECONDS have been captured; the caller then stops.
 */
export async function startRecording(opts: { onLevel?: (rms: number) => void; onCap?: () => void } = {}): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessorNode is deprecated but universal; AudioWorklet needs a separate module file.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  // A ScriptProcessor only fires while it is connected to the graph, but
  // connecting it straight to the speakers plays the microphone back and
  // howls. Silence the tap instead of removing it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  let total = 0, capped = false;
  node.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    total += input.length;
    if (opts.onLevel) {
      let s = 0;
      for (let i = 0; i < input.length; i++) s += input[i] * input[i];
      opts.onLevel(Math.sqrt(s / input.length));
    }
    if (!capped && total >= ctx.sampleRate * MAX_SECONDS) { capped = true; opts.onCap?.(); }
  };
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  let stopped: Promise<Blob> | null = null;
  return {
    stop: () => stopped ??= (async () => {
      node.disconnect(); mute.disconnect(); node.onaudioprocess = null;
      stream.getTracks().forEach(t => t.stop());
      const rate = ctx.sampleRate;
      await ctx.close();
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      const at16k = rate === SAMPLE_RATE ? merged : await resample(merged, rate, SAMPLE_RATE);
      return encodeWav(at16k, SAMPLE_RATE);
    })(),
  };
}

async function resample(samples: Float32Array, from: number, to: number): Promise<Float32Array> {
  const frames = Math.ceil(samples.length * to / from);
  const off = new OfflineAudioContext(1, frames, to);
  const buf = off.createBuffer(1, samples.length, from);
  buf.getChannelData(0).set(samples);
  const s = off.createBufferSource();
  s.buffer = buf; s.connect(off.destination); s.start();
  return (await off.startRendering()).getChannelData(0);
}

async function toWav16k(file: Blob): Promise<Blob> {
  const ac = new AudioContext();
  try {
    const decoded = await ac.decodeAudioData(await file.arrayBuffer());
    const n = Math.min(decoded.length, decoded.sampleRate * MAX_SECONDS);
    const mono = new Float32Array(n);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const d = decoded.getChannelData(ch);
      for (let i = 0; i < n; i++) mono[i] += d[i] / decoded.numberOfChannels;
    }
    const at16k = decoded.sampleRate === SAMPLE_RATE ? mono : await resample(mono, decoded.sampleRate, SAMPLE_RATE);
    return encodeWav(at16k, SAMPLE_RATE);
  } finally {
    await ac.close();
  }
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
