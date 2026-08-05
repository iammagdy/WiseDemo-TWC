import { createFileRoute, Link } from "@tanstack/react-router";
import { Landing } from "@/components/landing/Landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WiseDemo — Cinematic product videos from real clips" },
      {
        name: "description",
        content:
          "Drop your URL. Our agent maps your SaaS, scripts the flow, and records a real ≤60s product demo you can ship to social — no editors, no takes.",
      },
      { property: "og:title", content: "WiseDemo — Cinematic product demos, filmed by AI" },
      {
        property: "og:description",
        content: "Turn real product clips into polished, editable, downloadable launch videos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});
export { Link };
