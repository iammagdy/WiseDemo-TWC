"""OpenAI TTS via Emergent Universal Key."""
from __future__ import annotations

import os

from emergentintegrations.llm.openai import OpenAITextToSpeech


_tts: OpenAITextToSpeech | None = None


def _client() -> OpenAITextToSpeech:
    global _tts
    if _tts is None:
        _tts = OpenAITextToSpeech(api_key=os.environ["EMERGENT_LLM_KEY"])
    return _tts


async def synthesize_voiceover(text: str, out_path: str, voice: str = "onyx", model: str = "tts-1-hd") -> str:
    """Generate TTS MP3 file. Voice defaults to onyx (deep authoritative)."""
    audio = await _client().generate_speech(
        text=text,
        model=model,
        voice=voice,
        response_format="mp3",
        speed=1.0,
    )
    with open(out_path, "wb") as f:
        f.write(audio)
    return out_path
