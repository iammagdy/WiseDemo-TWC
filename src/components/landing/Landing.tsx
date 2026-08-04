import { Link } from "@tanstack/react-router";
import { useState } from "react";
import heroImage from "@/assets/hero-recording.jpg";
import verticalDemo from "@/assets/vertical-demo.jpg";

function Clapper({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="2" y="12" width="28" height="16" rx="2" fill="currentColor" opacity="0.15" />
      <rect
        x="2"
        y="12"
        width="28"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M2 8 L30 4 L30 12 L2 12 Z" fill="currentColor" />
      <path
        d="M6 5 L10 11 M12 4 L16 11 M18 4 L22 11 M24 3 L28 10"
        stroke="var(--color-background)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function Landing() {
  const [url, setUrl] = useState("");
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <Clapper className="h-6 w-6 shrink-0 text-primary" />
            <span className="font-mono-tight text-base font-semibold tracking-tight sm:text-lg">
              WiseDemo
            </span>
            <span className="ml-1 hidden rounded-sm border border-border px-1.5 py-0.5 font-mono-tight text-[10px] uppercase text-muted-foreground sm:inline">
              REC
            </span>
          </Link>
          <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">
              How it works
            </a>
            <a href="#showcase" className="hover:text-foreground">
              Showcase
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              to="/dashboard"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              Studio
            </Link>
            <Link
              to="/dashboard"
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 sm:px-3.5 sm:text-sm"
            >
              Start filming
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-x-0 top-0 h-[600px] bg-gradient-to-b from-primary/15 via-primary/5 to-transparent blur-3xl" />
        </div>
        <div className="mx-auto grid max-w-7xl gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:pt-28">
          <div className="flex flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 font-mono-tight text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-record" />
              Now filming • v1 preview
            </div>
            <h1 className="text-balance font-sans text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-7xl">
              Your SaaS,
              <br />
              <span
                className="italic"
                style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400 }}
              >
                filmed by an agent
              </span>{" "}
              in 60&nbsp;seconds.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Drop your URL. WiseDemo maps your product, scripts the flow with AI, drives a real
              browser, and hands you a cinematic ≤60-second demo — ready for X, LinkedIn, and
              Product Hunt.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                window.location.href = `/dashboard?url=${encodeURIComponent(url)}`;
              }}
              className="mt-8 flex w-full max-w-xl flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-glow)] sm:flex-nowrap"
            >
              <div className="flex shrink-0 items-center gap-2 pl-3 font-mono-tight text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-record" />
                https://
              </div>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yoursaas.com"
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-base outline-none placeholder:text-muted-foreground/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="w-full shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:w-auto"
              >
                Roll cameras →
              </button>
            </form>
            <p className="mt-3 font-mono-tight text-[11px] uppercase tracking-wider text-muted-foreground/70">
              Free tier • 3 demos • No credit card
            </p>

            <div className="mt-12 grid grid-cols-3 gap-3 border-t border-border pt-6 text-sm sm:gap-6">
              <Stat k="≤60s" v="Final cut" />
              <Stat k="1080p" v="Real browser" />
              <Stat k="0" v="Editors hired" />
            </div>
          </div>

          {/* Film-strip preview panel */}
          <div className="relative mt-4 lg:mt-0">
            <div className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              {/* Title bar */}
              <div className="flex items-center justify-between border-b border-border bg-background/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary animate-record" />
                  <span className="font-mono-tight text-[11px] uppercase tracking-wider text-muted-foreground">
                    scene_03.take_01
                  </span>
                </div>
                <span className="font-mono-tight text-[11px] text-muted-foreground">
                  00:42 / 01:00
                </span>
              </div>
              <img
                src={heroImage}
                alt="WiseDemo autonomous agent clicking a New Project button in a dark SaaS UI"
                width={1600}
                height={900}
                className="aspect-[16/10] w-full object-cover"
              />
              {/* Timeline strip */}
              <div className="grid grid-cols-6 gap-1 border-t border-border bg-background/60 p-2">
                {[0.4, 0.7, 0.55, 0.9, 0.6, 0.35].map((h, i) => (
                  <div
                    key={i}
                    className="flex h-8 items-end overflow-hidden rounded-sm bg-secondary"
                  >
                    <div className="w-full bg-primary/70" style={{ height: `${h * 100}%` }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Floating vertical preview */}
            <div className="absolute -bottom-8 -left-8 hidden w-[140px] rotate-[-4deg] overflow-hidden rounded-xl border border-border bg-card shadow-2xl md:block">
              <img
                src={verticalDemo}
                alt="Vertical 9:16 demo preview"
                width={720}
                height={1280}
                loading="lazy"
                className="aspect-[9/16] w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Logos marquee */}
      <section className="border-y border-border bg-card/30 py-6">
        <div className="overflow-hidden">
          <div className="animate-marquee flex w-max gap-14 whitespace-nowrap font-mono-tight text-xs uppercase tracking-widest text-muted-foreground">
            {[...Array(2)].flatMap((_, k) =>
              [
                "Solo builders",
                "YC W25",
                "Indie hackers",
                "Product Hunt launches",
                "SaaS founders",
                "Devtools",
                "AI startups",
              ].map((t) => (
                <span key={`${k}-${t}`} className="flex items-center gap-3">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  {t}
                </span>
              )),
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-28">
        <div className="mb-10 flex flex-col items-start justify-between gap-6 sm:mb-16 md:flex-row md:items-end md:gap-8">
          <div>
            <p className="mb-3 font-mono-tight text-xs uppercase tracking-widest text-primary">
              /// Production pipeline
            </p>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              Four takes. One cinematic cut.
            </h2>
          </div>
          <p className="hidden max-w-sm text-sm text-muted-foreground md:block">
            Every step runs on our infra — no browser extension, no local render, no Loom retakes.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition hover:border-primary/50"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="font-mono-tight text-xs uppercase text-muted-foreground">
                  Scene {String(i + 1).padStart(2, "0")}
                </span>
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition group-hover:opacity-100" />
            </div>
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section id="showcase" className="border-t border-border bg-card/30 py-16 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="mb-3 font-mono-tight text-xs uppercase tracking-widest text-primary">
            /// Dailies
          </p>
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Real recordings. Real products.
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="group relative overflow-hidden rounded-xl border border-border bg-background"
              >
                <div className="aspect-[9/16] w-full bg-gradient-to-br from-primary/20 via-background to-background" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
                  <span className="font-mono-tight text-[11px] uppercase text-muted-foreground">
                    Demo_00{n}.mp4
                  </span>
                  <span className="font-mono-tight text-[11px] text-primary">00:{40 + n * 4}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-28">
        <p className="mb-3 font-mono-tight text-xs uppercase tracking-widest text-primary">
          /// Rate card
        </p>
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          Studio budget, indie prices.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-2xl border p-6 sm:p-8 ${
                p.featured
                  ? "border-primary bg-card shadow-[var(--shadow-glow)]"
                  : "border-border bg-card/60"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-1 font-mono-tight text-[10px] uppercase tracking-widest text-primary-foreground">
                  Featured
                </span>
              )}
              <h3 className="font-mono-tight text-xs uppercase tracking-widest text-muted-foreground">
                {p.name}
              </h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-5xl font-semibold tracking-tight">${p.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{p.tag}</p>
              <ul className="mt-6 space-y-3 text-sm">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    {perk}
                  </li>
                ))}
              </ul>
              <Link
                to="/dashboard"
                className={`mt-8 rounded-lg py-2.5 text-center text-sm font-medium transition ${
                  p.featured
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-border hover:border-primary/60"
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <Clapper className="mx-auto mb-6 h-10 w-10 text-primary animate-snap" />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            Roll the first take.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Three demos on the house. Ship one before your competitor books an editor.
          </p>
          <Link
            to="/dashboard"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-record" />
            Start filming free
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center font-mono-tight text-xs uppercase tracking-widest text-muted-foreground">
        © {new Date().getFullYear()} WiseDemo Studios — All takes reserved.
      </footer>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="font-sans text-2xl font-semibold tracking-tight text-foreground">{k}</div>
      <div className="mt-1 font-mono-tight text-[11px] uppercase tracking-wider text-muted-foreground">
        {v}
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Scan the set",
    body: "Firecrawl walks your site and returns a structured map — routes, CTAs, key screens.",
    icon: IconScan,
  },
  {
    title: "Write the script",
    body: "Gemini turns the map into a 60-second shot list with beats, captions, and clicks.",
    icon: IconScript,
  },
  {
    title: "Roll cameras",
    body: "A cloud Chromium logs in, hits the flow, and records at 1080p — smooth cursor, no jitter.",
    icon: IconCamera,
  },
  {
    title: "Cut & deliver",
    body: "Zooms, captions, sound design, aspect exports — dropped straight in your dashboard.",
    icon: IconClap,
  },
];

const PLANS = [
  {
    name: "Extras",
    price: 0,
    tag: "For your first take.",
    perks: ["3 demos / month", "Public site scans", "Watermark", "720p output"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Director",
    price: 49,
    tag: "For shipping founders.",
    perks: [
      "30 demos / month",
      "Encrypted logins",
      "1080p, no watermark",
      "9:16 + 16:9 exports",
      "Custom captions",
    ],
    cta: "Book the studio",
    featured: true,
  },
  {
    name: "Studio",
    price: 199,
    tag: "For growth teams.",
    perks: [
      "Unlimited demos",
      "4K masters",
      "Voice-over track",
      "Brand kit",
      "Priority render queue",
    ],
    cta: "Contact production",
    featured: false,
  },
];

function IconScan(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M3 12h18" />
    </svg>
  );
}
function IconScript(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M6 3h9l4 4v14H6zM8 12h8M8 16h5M8 8h5" />
    </svg>
  );
}
function IconCamera(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="2" y="7" width="14" height="10" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </svg>
  );
}
function IconClap(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 10h18v10H3zM3 10l2-5 16-3-2 8" />
    </svg>
  );
}
