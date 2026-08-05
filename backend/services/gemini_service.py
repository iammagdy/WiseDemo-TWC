"""Gemini service: product analysis, demo scripting, and video review."""
from __future__ import annotations

import json
import os
from typing import Any

from google import genai
from google.genai import types


_client: genai.Client | None = None


def client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ["GEMINI_API_KEY"]
        _client = genai.Client(api_key=api_key)
    return _client


MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _extract_json(text: str) -> dict:
    """Extract JSON from a Gemini text response robustly."""
    text = text.strip()
    if text.startswith("```"):
        # strip fences
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    # Find the first { ... } block
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    return json.loads(text)


import re


async def analyze_product(snapshot: dict) -> dict:
    """Gemini turns scraped snapshot into structured product analysis."""
    prompt = f"""You are a product marketing strategist. Analyze this website snapshot and return a compact JSON object describing the product for a 45-second demo video.

Website snapshot:
{json.dumps(snapshot, ensure_ascii=False, indent=2)}

Return ONLY a JSON object with these exact keys:
{{
  "product_name": "Short brand name (2-4 words)",
  "tagline": "One punchy sentence (max 12 words)",
  "category": "e.g. SaaS, e-commerce, developer tool, mobile app",
  "target_audience": "Who is this for (1 sentence)",
  "top_features": ["Feature 1 (3-6 words)", "Feature 2", "Feature 3"],
  "primary_cta": "Main action text (2-4 words)",
  "hook": "Attention-grabbing opening line for the demo (max 14 words)",
  "outro": "Closing punchline before CTA (max 12 words)",
  "primary_color": "hex color guess based on product category (e.g. #6366F1)",
  "vibe": "One word describing the emotional tone (e.g. bold, calm, energetic, premium)"
}}

Be specific, avoid generic marketing fluff. Base every claim on the snapshot content."""

    resp = client().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.4,
        ),
    )
    return _extract_json(resp.text or "{}")


async def plan_demo(product: dict, url: str) -> dict:
    """Return a scripted scenario for Steel + narration segments."""
    prompt = f"""You are a video director scripting a 45-second autonomous demo of a website.

Product analysis:
{json.dumps(product, ensure_ascii=False, indent=2)}

Start URL: {url}

Design a scripted browser tour that a headless browser will perform. The browser will visit the start URL and perform the actions in order. Every action MUST be safe on a public marketing website: only navigate, scroll, and hover. NEVER click login/signup/purchase actions.

Also write a matching voiceover script split into scenes. The total voiceover must be about 40 seconds when spoken at normal pace (approximately 100 words).

Return ONLY JSON with this exact schema:
{{
  "actions": [
    {{"type": "goto", "url": "the start url", "wait_ms": 3000}},
    {{"type": "scroll", "y": 400, "wait_ms": 2000}},
    {{"type": "scroll", "y": 800, "wait_ms": 2000}},
    {{"type": "hover", "text": "visible link/button text to hover", "wait_ms": 1500}},
    {{"type": "scroll", "y": 1400, "wait_ms": 2000}},
    {{"type": "scroll", "y": 1800, "wait_ms": 2000}}
  ],
  "scenes": [
    {{"caption": "Big hook, max 8 words", "narration": "Full narration sentence for this scene."}},
    {{"caption": "Feature 1 headline", "narration": "..."}} ,
    {{"caption": "Feature 2 headline", "narration": "..."}} ,
    {{"caption": "Proof or benefit", "narration": "..."}} ,
    {{"caption": "Call to action", "narration": "Full narration ending with a CTA."}}
  ]
}}

Rules:
- 5 to 7 actions total, in a natural top-to-bottom exploration
- 4 to 5 scenes, each ~8 seconds of narration
- Captions are punchy and short, no punctuation at end
- Narration is warm and confident, no exclamations
- Do not mention pricing unless product analysis proves a pricing tier
- Never invent features not in top_features"""

    resp = client().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.6,
        ),
    )
    return _extract_json(resp.text or "{}")


async def review_video(video_path: str, product: dict) -> dict:
    """Gemini reviews the raw recording and returns feedback. Optional."""
    try:
        f = client().files.upload(file=video_path, config={"mime_type": "video/mp4"})
        # Wait for active
        import asyncio as _a
        for _ in range(20):
            if getattr(f, "state", "") == "ACTIVE":
                break
            await _a.sleep(2)
            f = client().files.get(name=f.name)
        prompt = (
            "Review this 45-second product demo for professionalism. "
            f"Product: {product.get('product_name')}. "
            "Return JSON with keys score(0-100), status(pass|warn|fail), summary(str), issues(list of str)."
        )
        resp = client().models.generate_content(
            model=MODEL,
            contents=[f, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        try:
            client().files.delete(name=f.name)
        except Exception:
            pass
        return _extract_json(resp.text or "{}")
    except Exception as e:
        return {"score": 0, "status": "warn", "summary": f"Review skipped: {e}", "issues": []}
