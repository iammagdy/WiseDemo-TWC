import { createFileRoute, Link } from "@tanstack/react-router";
import { Landing } from "@/components/landing/Landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DemoForge — Cinematic product demos, filmed by AI in 60 seconds" },
      {
        name: "description",
        content:
          "Drop your URL. Our agent maps your SaaS, scripts the flow, and records a real ≤60s product demo you can ship to social — no editors, no takes.",
      },
      { property: "og:title", content: "DemoForge — Cinematic product demos, filmed by AI" },
      {
        property: "og:description",
        content:
          "An autonomous browser records a real, polished ≤60s demo of your SaaS. Built for solo founders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});
export { Link };
