"""WiseDemo v2 backend tests - covers health, jobs CRUD, validation, and full pipeline e2e."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env fallback
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


# --- Basics ---
def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert "time" in data


# --- Validation ---
@pytest.mark.parametrize("bad", ["", "   ", "not a url", "abc"])
def test_create_job_invalid_url(bad):
    r = requests.post(f"{API}/jobs", json={"url": bad}, timeout=15)
    # Pydantic min_length triggers 422; custom validator triggers 400
    assert r.status_code in (400, 422), f"Expected 400/422 for '{bad}', got {r.status_code}: {r.text}"


# --- Create valid job ---
def test_create_job_valid_and_get():
    r = requests.post(f"{API}/jobs", json={"url": "https://linear.app"}, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "id" in j and j["status"] == "queued"
    assert j["progress"] > 0
    assert j["url"].startswith("https://")

    # GET single
    r2 = requests.get(f"{API}/jobs/{j['id']}", timeout=15)
    assert r2.status_code == 200
    assert r2.json()["id"] == j["id"]


def test_get_unknown_job_404():
    r = requests.get(f"{API}/jobs/00000000-0000-0000-0000-000000000000", timeout=15)
    assert r.status_code == 404


def test_list_jobs():
    r = requests.get(f"{API}/jobs", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1


def test_video_before_ready_404():
    # create a fresh job, immediately fetch video -> should 404 (not ready)
    r = requests.post(f"{API}/jobs", json={"url": "https://vercel.com"}, timeout=15)
    assert r.status_code == 200
    jid = r.json()["id"]
    rv = requests.get(f"{API}/jobs/{jid}/video", timeout=15, allow_redirects=False)
    assert rv.status_code == 404


# --- Full pipeline e2e ---
def test_full_pipeline_e2e():
    r = requests.post(f"{API}/jobs", json={"url": "https://vercel.com"}, timeout=15)
    assert r.status_code == 200, r.text
    jid = r.json()["id"]
    print(f"\n[e2e] Created job {jid}")

    deadline = time.time() + 240  # 4 minutes
    last_status = None
    last_step = None
    last_progress = -1
    doc = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{API}/jobs/{jid}", timeout=60)
        except requests.exceptions.ReadTimeout:
            print("[e2e] poll read timeout, retrying...")
            time.sleep(3)
            continue
        assert r.status_code == 200
        doc = r.json()
        if (doc["status"], doc["step"], doc["progress"]) != (last_status, last_step, last_progress):
            last_status, last_step, last_progress = doc["status"], doc["step"], doc["progress"]
            print(f"[e2e] status={last_status} progress={last_progress} step={last_step}")
        if doc["status"] == "ready":
            break
        if doc["status"] == "failed":
            pytest.fail(f"Pipeline failed: {doc.get('error')!r}")
        time.sleep(5)
    else:
        pytest.fail(f"Timeout waiting for job. Last doc: {doc}")

    assert doc["progress"] == 100
    assert doc["product"] is not None
    for k in ("product_name", "tagline", "top_features"):
        assert k in doc["product"], f"missing product.{k}"
    assert doc["video_url"] is not None
    assert 30 <= (doc["duration_seconds"] or 0) <= 70, f"duration out of range: {doc.get('duration_seconds')}"

    # Fetch video
    rv = requests.get(f"{BASE_URL}{doc['video_url']}", timeout=60)
    assert rv.status_code == 200
    assert rv.headers.get("content-type", "").startswith("video/mp4")
    assert len(rv.content) > 200 * 1024, f"Video too small: {len(rv.content)} bytes"

    # Download variant
    rd = requests.get(f"{BASE_URL}{doc['video_url']}?download=1", timeout=60)
    assert rd.status_code == 200
    cd = rd.headers.get("content-disposition", "")
    assert "attachment" in cd.lower(), f"Missing attachment header: {cd!r}"
