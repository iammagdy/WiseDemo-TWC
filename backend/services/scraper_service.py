"""Scrape a URL and extract lightweight product signals for Gemini."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup


UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0 Safari/537.36"
)


def _text(el) -> str:
    if not el:
        return ""
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()[:500]


async def scrape_url(url: str) -> dict:
    """Return a compact snapshot: title, description, headings, ctas, logo."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0, headers={"User-Agent": UA}) as client:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text
        final_url = str(r.url)

    soup = BeautifulSoup(html, "html.parser")

    title = _text(soup.title) or ""
    meta_desc = ""
    m = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    if m and m.get("content"):
        meta_desc = m["content"].strip()[:500]

    og_title = ""
    ot = soup.find("meta", attrs={"property": "og:title"})
    if ot and ot.get("content"):
        og_title = ot["content"].strip()[:200]

    # Headings
    h1 = [_text(h) for h in soup.find_all("h1")[:3] if _text(h)]
    h2 = [_text(h) for h in soup.find_all("h2")[:6] if _text(h)]

    # CTAs — buttons and prominent links
    cta_candidates = []
    for tag in soup.find_all(["a", "button"])[:60]:
        t = _text(tag)
        if 3 <= len(t) <= 40 and re.search(r"(sign|start|try|get|book|demo|free|buy|download|watch|explore|learn|see)", t, re.I):
            cta_candidates.append(t)
    ctas = list(dict.fromkeys(cta_candidates))[:6]

    # Logo
    logo = ""
    for sel in [{"rel": "icon"}, {"rel": "shortcut icon"}, {"property": "og:image"}]:
        el = soup.find("link", attrs=sel) or soup.find("meta", attrs=sel)
        if el:
            href = el.get("href") or el.get("content")
            if href:
                logo = urljoin(final_url, href)
                break

    parsed = urlparse(final_url)
    brand = parsed.netloc.replace("www.", "").split(".")[0]

    return {
        "url": final_url,
        "brand_slug": brand,
        "title": title,
        "og_title": og_title,
        "description": meta_desc,
        "h1": h1,
        "h2": h2,
        "ctas": ctas,
        "logo_url": logo,
    }
