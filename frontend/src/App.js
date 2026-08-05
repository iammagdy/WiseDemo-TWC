import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Download, ArrowRight, RotateCcw } from "lucide-react";
import "./App.css";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

const STEP_LABELS = [
  { key: "analyzing", label: "Analyzing" },
  { key: "planning", label: "Scripting" },
  { key: "recording", label: "Filming" },
  { key: "voiceover", label: "Voicing" },
  { key: "composing", label: "Editing" },
];

// Map any pipeline status to the closest visible step index (0..4)
function stageIndex(status) {
  switch (status) {
    case "queued":
    case "analyzing":
      return 0;
    case "planning":
      return 1;
    case "recording":
    case "fetching":
      return 2;
    case "voiceover":
      return 3;
    case "composing":
      return 4;
    case "ready":
      return 5; // beyond last
    default:
      return 0;
  }
}

function Header() {
  return (
    <header className="top" data-testid="app-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden />
        <div className="brand-name">
          Wise<span>Demo</span>
        </div>
      </div>
      <div className="stack-info">
        <div>Filmed by AI · Steel + Gemini</div>
        <div><b>v2.0</b> · autonomous cut</div>
      </div>
    </header>
  );
}

function ReelDecoration() {
  return (
    <div className="reel" aria-hidden>
      <svg viewBox="0 0 620 620" width="620" height="620">
        <defs>
          <radialGradient id="rg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#ff5a1f" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="310" cy="310" r="280" fill="none" stroke="url(#rg)" strokeWidth="1.4" />
        <circle cx="310" cy="310" r="230" fill="none" stroke="rgba(212,178,106,0.35)" strokeWidth="1" strokeDasharray="4 6" />
        <circle cx="310" cy="310" r="160" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
        <circle cx="310" cy="310" r="80" fill="none" stroke="rgba(255,90,31,0.4)" strokeWidth="1" />
        <g fill="rgba(255,90,31,0.9)">
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 12;
            const x = 310 + Math.cos(a) * 280;
            const y = 310 + Math.sin(a) * 280;
            return <circle key={i} cx={x} cy={y} r="3" />;
          })}
        </g>
      </svg>
    </div>
  );
}

function LandingForm({ onCreated }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const clean = url.trim();
    if (!clean) return setErr("Paste your product URL to start.");
    setBusy(true);
    setErr("");
    try {
      const { data } = await axios.post(`${API}/jobs`, { url: clean });
      onCreated(data.id);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to start.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hero">
      <div className="slate">
        <span className="rec" /> Take 01 · Cinematic AI cut
      </div>
      <h1 className="title serif">
        Drop a URL.<br />
        Get a <em>filmed</em> demo.
      </h1>
      <p className="sub">
        WiseDemo sends a real cloud browser to tour your product, writes the script with Gemini,
        voices it with a professional TTS, and cuts a 45-second launch video you can post today.
      </p>

      <form className="form-wrap" onSubmit={submit} data-testid="landing-form">
        <div className="url-field">
          <span className="proto mono">https://</span>
          <input
            data-testid="url-input"
            placeholder="yourproduct.com"
            value={url}
            onChange={(e) => setUrl(e.target.value.replace(/^https?:\/\//, ""))}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button
          className="go-btn"
          type="submit"
          disabled={busy}
          data-testid="generate-video-btn"
        >
          {busy ? "Rolling…" : "Roll camera"}
          <ArrowRight size={16} />
        </button>
      </form>

      {err && <div className="err" data-testid="landing-error">{err}</div>}
      <div className="hint mono">
        NO EDITS · NO TAKES · <b>{"~"}90 SECONDS</b> FROM URL TO DOWNLOAD
      </div>
    </section>
  );
}

function HowRow() {
  const cells = [
    { n: "01 · Read", h: "Understand", p: "Gemini reads your homepage and figures out what your product actually does — no manual brief." },
    { n: "02 · Script", h: "Direct", p: "A shot list is drafted: what to scroll to, what to zoom on, what the voiceover will say per scene." },
    { n: "03 · Film", h: "Record", p: "A real Chromium in Steel Browser drives the tour and records at 25fps H.264 — no interaction from you." },
    { n: "04 · Cut", h: "Deliver", p: "Voiceover, captions, intro & outro cards are baked in with FFmpeg. You get a downloadable MP4." },
  ];
  return (
    <section className="rows" data-testid="how-it-works">
      {cells.map((c, i) => (
        <div className="row-card" key={i}>
          <div className="num">{c.n}</div>
          <h3 className="serif">{c.h}</h3>
          <p>{c.p}</p>
        </div>
      ))}
    </section>
  );
}

function Ticker() {
  const items = [
    "AUTONOMOUS SHOOT", "GEMINI 2.5 · SCRIPTING", "STEEL BROWSER · 25FPS", "OPENAI TTS · ONYX VOICE",
    "1920 × 1080", "FFMPEG COMPOSITED", "READY IN ~90S", "NO EDITORS", "NO TAKES",
  ];
  const track = [...items, ...items];
  return (
    <div className="ticker" aria-hidden data-testid="ticker">
      <div className="ticker-track">
        {track.map((t, i) => (
          <span key={i}>
            <b>◉</b> {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Landing({ onCreated }) {
  return (
    <>
      <Header />
      <ReelDecoration />
      <LandingForm onCreated={onCreated} />
      <HowRow />
      <Ticker />
    </>
  );
}

function Progress({ job, onReset }) {
  const idx = stageIndex(job.status);
  return (
    <div className="stage" data-testid="progress-screen">
      <div className="stage-slate">
        <div className="scene-info mono">
          Scene <b>0{Math.min(5, idx + 1)}</b> of 05 · Take <b>01</b>
        </div>
        <div className="scene-info mono">Job <b>{job.id.slice(0, 8)}</b></div>
      </div>

      <div className="stage-header">
        <div className="stage-rec" />
        <h2 className="serif">{job.step || "Rolling camera"}</h2>
      </div>
      <div className="stage-current-step">
        {job.status === "queued" ? "Queuing the shoot…" : job.step}
      </div>

      <div className="progress-outer" data-testid="progress-bar">
        <div
          className="progress-inner"
          style={{ width: `${Math.max(4, Math.min(100, job.progress))}%` }}
        />
      </div>
      <div className="progress-labels">
        <span>PROGRESS</span>
        <span>{job.progress}%</span>
      </div>

      <div className="steps-grid" data-testid="steps-grid">
        {STEP_LABELS.map((s, i) => {
          const cls = i < idx ? "done" : i === idx ? "active" : "";
          return (
            <div className={`step-cell ${cls}`} key={s.key} data-testid={`step-${s.key}`}>
              <div className="step-idx mono">STAGE 0{i + 1}</div>
              <div className="step-name">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 30 }}>
        <button className="btn-ghost" onClick={onReset} data-testid="cancel-progress-btn">
          <RotateCcw size={14} /> Start another
        </button>
      </div>
    </div>
  );
}

function Ready({ job, onReset }) {
  const videoUrl = job.video_url ? `${process.env.REACT_APP_BACKEND_URL}${job.video_url}` : null;
  const downloadUrl = videoUrl ? `${videoUrl}?download=1` : null;
  const product = job.product || {};
  const filename = `${(product.product_name || "demo").replace(/\s+/g, "_")}-${job.id.slice(0, 8)}.mp4`;
  return (
    <div className="result-wrap" data-testid="ready-screen">
      <div className="result-header">
        <h2 className="serif">The reel is ready.</h2>
        <span className="meta">
          {product.product_name || "Untitled"} · {Math.round(job.duration_seconds || 0)}s
        </span>
      </div>

      <div className="player" data-testid="video-player">
        {videoUrl && (
          <video src={videoUrl} controls autoPlay muted loop playsInline preload="auto" />
        )}
      </div>

      <div className="result-actions">
        <a
          className="go-btn"
          href={downloadUrl}
          download={filename}
          data-testid="download-video-btn"
          style={{ textDecoration: "none" }}
        >
          <Download size={16} /> Download MP4
        </a>
        <button className="btn-ghost" onClick={onReset} data-testid="new-demo-btn">
          <RotateCcw size={14} /> Film another
        </button>
      </div>

      {product.tagline && (
        <div className="product-brief" data-testid="product-brief">
          <div className="label mono">GEMINI READ IT AS</div>
          <h4 className="serif">{product.product_name}</h4>
          <p>{product.tagline}</p>
          {product.top_features?.length ? (
            <p style={{ marginTop: 10 }}>
              <span style={{ color: "var(--gold)" }}>Features · </span>
              {product.top_features.join(" · ")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Failed({ job, onReset }) {
  return (
    <div className="stage" data-testid="failed-screen">
      <div className="stage-header">
        <div className="stage-rec" style={{ background: "#ff3860", boxShadow: "0 0 24px #ff3860" }} />
        <h2 className="serif">Cut. That take didn't land.</h2>
      </div>
      <div className="fail-box">
        <b>Reason:</b>{" "}
        <span data-testid="failed-message">{job.error || "Unknown error"}</span>
      </div>
      <div style={{ marginTop: 24 }}>
        <button className="go-btn" onClick={onReset} data-testid="retry-btn">
          <RotateCcw size={14} /> Try another URL
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const { data } = await axios.get(`${API}/jobs/${jobId}`);
        if (stopped) return;
        setJob(data);
        if (data.status === "ready" || data.status === "failed") return;
      } catch (e) {
        // keep polling
      }
      timerRef.current = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId]);

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setJobId(null);
    setJob(null);
  };

  const view = useMemo(() => {
    if (!jobId) return "landing";
    if (!job) return "progress";
    if (job.status === "ready") return "ready";
    if (job.status === "failed") return "failed";
    return "progress";
  }, [jobId, job]);

  return (
    <div className="page grain">
      {view === "landing" && <Landing onCreated={setJobId} />}
      {view === "progress" && <Progress job={job || { id: jobId, status: "queued", progress: 4, step: "Queuing" }} onReset={reset} />}
      {view === "ready" && <Ready job={job} onReset={reset} />}
      {view === "failed" && <Failed job={job} onReset={reset} />}
    </div>
  );
}
