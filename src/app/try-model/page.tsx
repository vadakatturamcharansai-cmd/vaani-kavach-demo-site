"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mic, Upload, StopCircle, Loader2, AlertCircle, CheckCircle2, FileKey, Terminal } from "lucide-react";
import {
  analyzeAudio, authorizeAction, exchanges, getHealth, onExchange, startRecording, verifyReceipt,
  type AuthorizeResult, type InferenceResult, type Recorder, type RiskReceipt, type ServiceHealth,
} from "@/services/modelApiClient";

// Kept as the label for a failed call: the detector is connected now, so this
// shows only when a request is actually rejected or unreachable.
const ERROR_MESSAGE = "Code 4213";
const VERDICT_TEXT = { HUMAN: "text-emerald-700", UNCERTAIN: "text-amber-700", AI_SPOOF: "text-red-700" } as const;

export default function TryModelPage() {
  const [activeTab, setActiveTab] = useState<"model" | "api" | "receipt">("model");
  const [isRecording, setIsRecording] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResultState] = useState<InferenceResult | null>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [exchangeTick, setExchangeTick] = useState(0);
  const [editedReceipt, setEditedReceipt] = useState("");
  const [verifyOut, setVerifyOut] = useState<{ valid: boolean; reason: string } | null>(null);
  const [authorizeOut, setAuthorizeOut] = useState<AuthorizeResult | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getHealth().then(setHealth);
    const unsubscribe = onExchange(() => setExchangeTick(t => t + 1));
    return () => {
      unsubscribe();
      // Unmounting mid-recording would otherwise leave the microphone open.
      if (timer.current) clearInterval(timer.current);
      void recorder.current?.stop();
      recorder.current = null;
    };
  }, []);

  // A new verdict resets the receipt playground; done in the setter, not an effect.
  const setResult = (r: InferenceResult | null) => {
    setResultState(r);
    setEditedReceipt(r?.receipt ? JSON.stringify(r.receipt, null, 2) : "");
    setVerifyOut(null);
    setAuthorizeOut(null);
  };

  const stopRecording = async () => {
    if (!recorder.current) return;
    const rec = recorder.current;
    recorder.current = null;
    if (timer.current) clearInterval(timer.current);
    setIsRecording(false);
    try {
      const blob = await rec.stop();
      if (blob.size < 16000) {
        setResult({ status: "error", error: "Recording too short — speak for at least half a second." });
        return;
      }
      setRecording(blob);
      setFile(null);
    } catch (error) {
      setResult({ status: "error", error: `Recording failed: ${(error as Error).message}` });
    }
  };

  const toggleRecording = async () => {
    setResult(null);
    if (recorder.current) return stopRecording();
    try {
      recorder.current = await startRecording({ onCap: () => { void stopRecording(); } });
    } catch {
      setResult({ status: "error", error: "Microphone blocked. Allow microphone access, or upload a file instead." });
      return;
    }
    setRecording(null);
    setSeconds(0);
    setIsRecording(true);
    const startedAt = Date.now();
    timer.current = setInterval(() => setSeconds((Date.now() - startedAt) / 1000), 100);
  };

  const handleUploadClick = () => {
    document.getElementById("audio-upload")?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setRecording(null);
      setResult(null);
    }
  };

  const handleAnalyze = async () => {
    setIsProcessing(true);
    setResult(null);
    
    const audioData = file || recording;
    if (!audioData) { setIsProcessing(false); return; }

    try {
      const res = await analyzeAudio(audioData);
      if (res.error || res.status === "error" || res.status === "not_connected") {
        console.error(`[${ERROR_MESSAGE}] Audio analysis:`, res.error || res.status);
      }
      setResult(res);
    } catch (error) {
      console.error(`[${ERROR_MESSAGE}] Audio analysis:`, error);
      setResult({ status: "error", error: (error as Error).message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="page-shell container mx-auto px-5 max-w-5xl min-h-[calc(100vh-4rem)] space-y-12">
      <div className="text-center space-y-4">
        <h1 className="page-heading text-4xl sm:text-5xl font-semibold text-foreground">Technical Validation Lab</h1>
        <p className="text-lg text-muted-foreground font-normal">
          Evaluate voice-analysis components and review secure API exchanges.
        </p>
      </div>

      {health?.status === "healthy" ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-4 mx-auto max-w-2xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-800 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-emerald-800 text-sm">Live detector connected — {health.model_version}</p>
            <p className="text-emerald-800 text-xs font-normal leading-relaxed">
              AASIST anti-spoofing on CPU, ONNX Runtime, model loaded in {health.model_load_ms} ms.
              {health.receipts_enabled ? " Risk receipts are HMAC-signed." : " Receipts unsigned on this deployment (RECEIPT_SECRET not set) — tab C needs it."}
              {" "}Audio is scored in memory and not stored.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-4 mx-auto max-w-2xl">
          <AlertCircle className="w-5 h-5 text-amber-800 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-amber-800 text-sm">{health ? ERROR_MESSAGE : "Checking detector…"}</p>
            <p className="text-amber-800 text-xs font-normal leading-relaxed">
              {health?.reason ?? "Contacting the Vaani Kavach inference service."} This workbench never fabricates a verdict.
            </p>
          </div>
        </div>
      )}

      <div className="workbench-tabs flex border-b border-border mb-8 max-w-3xl mx-auto">
        <button 
          onClick={() => setActiveTab("model")} 
          aria-pressed={activeTab === "model"}
          data-active={activeTab === "model"}
          className={`flex-1 pb-4 text-sm font-medium transition-colors border-b-2 ${activeTab === "model" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground/80"}`}
        >
          A. Real Voice Model
        </button>
        <button 
          onClick={() => setActiveTab("api")} 
          aria-pressed={activeTab === "api"}
          data-active={activeTab === "api"}
          className={`flex-1 pb-4 text-sm font-medium transition-colors border-b-2 ${activeTab === "api" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground/80"}`}
        >
          B. API Exchange
        </button>
        <button 
          onClick={() => setActiveTab("receipt")} 
          aria-pressed={activeTab === "receipt"}
          data-active={activeTab === "receipt"}
          className={`flex-1 pb-4 text-sm font-medium transition-colors border-b-2 ${activeTab === "receipt" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground/80"}`}
        >
          C. Receipt Security
        </button>
      </div>

      <div className="max-w-3xl mx-auto">
        <AnimatePresence mode="wait">
          
          {/* TAB A: REAL VOICE MODEL */}
          {activeTab === "model" && (
            <motion.div key="model" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid md:grid-cols-2 gap-12 items-start">
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-xl font-medium tracking-tight">Audio Input</h2>
                  <p className="text-sm text-muted-foreground font-normal">Record or upload an audio clip for real inference.</p>
                </div>
                
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center h-48 border border-dashed border-border rounded-xl bg-card">
                    {isRecording ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
                          <Mic className="w-5 h-5 text-red-700" />
                        </div>
                        <span className="text-red-700 text-sm font-medium">Recording... {seconds.toFixed(1)}s / 20s</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Mic className="w-8 h-8 opacity-50" />
                        <span className="text-sm font-normal">{recording ? `Recording ready (${(recording.size / 32000).toFixed(1)}s)` : file ? file.name : "Use your microphone to record"}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Button 
                      variant={isRecording ? "destructive" : "outline"} 
                      className={`gap-2 ${!isRecording && 'border-border hover:bg-card bg-transparent'}`}
                      onClick={toggleRecording}
                    >
                      {isRecording ? (
                        <><StopCircle className="w-4 h-4" /> Stop</>
                      ) : (
                        <><Mic className="w-4 h-4" /> Record</>
                      )}
                    </Button>
                    <Button variant="outline" className="gap-2 border-border hover:bg-card bg-transparent" onClick={handleUploadClick}>
                      <Upload className="w-4 h-4" /> 
                      {file ? "Change File" : "Upload"}
                    </Button>
                    <input 
                      type="file" 
                      id="audio-upload" 
                      className="hidden" 
                      accept="audio/*,.wav,.mp3,.mpeg,.mpg,.flac,.ogg,.oga,.opus,.m4a,.aac,.mp4,.webm,.3gp"
                      onChange={handleFileChange}
                    />
                  </div>
                  
                  <AnimatePresence>
                    {(file || recording || isRecording) && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                        <Button className="w-full mt-2" disabled={isRecording || isProcessing} onClick={handleAnalyze}>
                          {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</> : "Send to Inference Engine"}
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-xl font-medium tracking-tight">Backend Output</h2>
                </div>
                <div aria-live="polite" className="workbench-output h-[288px] border border-border rounded-xl flex flex-col p-6 overflow-hidden relative">
                  {result?.status === "completed" ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col justify-between text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className={`text-2xl font-semibold tracking-tight ${VERDICT_TEXT[result.verdict!]}`}>{result.verdict!.replace("_", " ")}</span>
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{result.action} · {result.riskLevel}</span>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">Risk score</dt><dd className="font-mono text-right">{result.riskScore} / 100</dd>
                        <dt className="text-muted-foreground">Authenticity</dt><dd className="font-mono text-right">{result.authenticityScore == null ? "—" : (result.authenticityScore * 100).toFixed(1) + "%"}</dd>
                        <dt className="text-muted-foreground">Confidence</dt><dd className="font-mono text-right">{((1 - (result.uncertainty ?? 0)) * 100).toFixed(1)}%</dd>
                        <dt className="text-muted-foreground">Audio quality</dt><dd className="font-mono text-right">{result.audioQuality}</dd>
                        <dt className="text-muted-foreground">Inference</dt><dd className="font-mono text-right">{Math.round(result.latencyMs ?? 0)} ms</dd>
                        <dt className="text-muted-foreground">Receipt</dt><dd className="font-mono text-right">{result.receipt ? result.receipt.session_id : "unsigned"}</dd>
                      </dl>
                      {result.timeline && result.timeline.length > 0 && (
                        <div
                          role="img"
                          className="flex items-end gap-1 h-8"
                          aria-label={`Risk per window: ${result.timeline.map(w => `${w.t}s ${w.risk}`).join(", ")}`}
                        >
                          {result.timeline.map(w => (
                            <div key={w.t} aria-hidden="true" title={`${w.t}s: risk ${w.risk}`} className={`flex-1 rounded-sm ${w.risk >= 70 ? "bg-red-500/70" : w.risk >= 40 ? "bg-amber-500/70" : "bg-emerald-500/70"}`} style={{ height: `${Math.max(8, w.risk)}%` }} />
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground font-normal leading-snug">{result.evidence?.join(" · ")}</p>
                    </motion.div>
                  ) : result ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
                      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                        <AlertCircle className="w-8 h-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground font-normal">{ERROR_MESSAGE}</p>
                        <p className="text-xs text-muted-foreground font-normal">{result.error}</p>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                      <Terminal className="w-8 h-8 mb-3 opacity-50" />
                      <p className="text-sm font-normal">Awaiting submission</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB B: API EXCHANGE */}
          {activeTab === "api" && (
            <motion.div key="api" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              {exchanges.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 bg-card border border-dashed border-border rounded-xl">
                  <Terminal className="w-12 h-12 text-muted-foreground" />
                  <h3 className="text-lg font-medium">No exchanges yet</h3>
                  <p className="text-muted-foreground font-normal max-w-md">
                    Run a check in tab A or a verification in tab C. The exact JSON sent to and returned by the Vaani Kavach API appears here, newest first.
                  </p>
                </div>
              ) : (
                <div className="space-y-4" data-tick={exchangeTick}>
                  {exchanges.map((x, i) => (
                    <div key={x.at + i} className="bg-card border border-border rounded-xl p-4 space-y-2 text-xs">
                      <div className="flex flex-wrap justify-between gap-2 font-mono">
                        <span className="font-medium">{x.method} {x.path}</span>
                        <span className="text-muted-foreground">HTTP {x.status} · {x.ms} ms · {x.at.slice(11, 19)} UTC</span>
                      </div>
                      {x.request != null && <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">→ {JSON.stringify(x.request, null, 2)}</pre>}
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all">← {JSON.stringify(x.response, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB C: RECEIPT SECURITY */}
          {activeTab === "receipt" && (
            <motion.div key="receipt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              {!result?.receipt ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 bg-card border border-dashed border-border rounded-xl">
                  <FileKey className="w-12 h-12 text-muted-foreground" />
                  <h3 className="text-lg font-medium">No receipt to test</h3>
                  <p className="text-muted-foreground font-normal max-w-md">
                    {health?.receipts_enabled === false
                      ? "This deployment has no RECEIPT_SECRET, so the detector issues no signed receipts and the bank step treats every voice as unverified."
                      : "Run a voice check in tab A. The HMAC-SHA256 receipt it returns can be edited here and re-verified — any change to the risk score, verdict or expiry fails the signature."}
                  </p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-8 items-start">
                  <div className="space-y-3">
                    <h3 className="text-lg font-medium">Risk receipt (editable)</h3>
                    <textarea
                      aria-label="Risk receipt JSON"
                      className="w-full h-72 font-mono text-xs bg-card border border-border rounded-xl p-3"
                      value={editedReceipt}
                      onChange={e => setEditedReceipt(e.target.value)}
                      spellCheck={false}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" className="border-border hover:bg-card bg-transparent" onClick={async () => {
                        try { setVerifyOut(await verifyReceipt(JSON.parse(editedReceipt))); }
                        catch (error) { setVerifyOut({ valid: false, reason: `not valid JSON: ${(error as Error).message}` }); }
                      }}>Verify signature</Button>
                      <Button onClick={async () => {
                        let receipt: RiskReceipt | null = null;
                        try { receipt = JSON.parse(editedReceipt); } catch { receipt = null; }
                        try {
                          setAuthorizeOut(await authorizeAction({ receipt, amount: 25000, contact_status: "unknown", first_payee: true }));
                        } catch (error) {
                          setAuthorizeOut(null);
                          setVerifyOut({ valid: false, reason: `${ERROR_MESSAGE} — ${(error as Error).message}` });
                        }
                      }}>Attempt ₹25,000 transfer</Button>
                    </div>
                  </div>
                  <div className="space-y-4 text-sm">
                    <h3 className="text-lg font-medium">Verification</h3>
                    <div aria-live="polite" className="bg-card border border-border rounded-xl p-4 space-y-3">
                      {verifyOut ? (
                        <p className={verifyOut.valid ? "text-emerald-700" : "text-red-700"}>
                          <span className="font-medium">{verifyOut.valid ? "VALID" : "REJECTED"}</span> — {verifyOut.reason}
                        </p>
                      ) : <p className="text-muted-foreground font-normal">Edit any field (try <code>risk_score</code>) and verify.</p>}
                      {authorizeOut && (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-border pt-3">
                          <dt className="text-muted-foreground">Decision</dt><dd className={`font-mono text-right font-medium ${authorizeOut.decision === "ALLOW" ? "text-emerald-700" : "text-red-700"}`}>{authorizeOut.decision}</dd>
                          <dt className="text-muted-foreground">Voice risk</dt><dd className="font-mono text-right">{authorizeOut.voice_risk}{authorizeOut.voice_verified ? "" : " (unverified)"}</dd>
                          <dt className="text-muted-foreground">Context risk</dt><dd className="font-mono text-right">+{authorizeOut.context_risk}</dd>
                          <dt className="text-muted-foreground">Final</dt><dd className="font-mono text-right">{authorizeOut.final_risk} · {authorizeOut.risk_level}</dd>
                          {authorizeOut.step_up_methods.length > 0 && <><dt className="text-muted-foreground">Step-up</dt><dd className="font-mono text-right">{authorizeOut.step_up_methods.join(", ")}</dd></>}
                          {authorizeOut.note && <dd className="col-span-2 text-muted-foreground font-normal">{authorizeOut.note}</dd>}
                        </dl>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
