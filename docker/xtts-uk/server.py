import io
import os
import wave
from pathlib import Path
from typing import Annotated

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

CKPT_DIR = Path(os.environ.get("XTTS_CHECKPOINT_DIR", "/data/xtts/checkpoints"))
SPEAKERS_DIR = Path(os.environ.get("XTTS_SPEAKERS_DIR", "/data/xtts/speakers"))
OUTPUT_DIR = Path(os.environ.get("XTTS_OUTPUT_DIR", "/data/xtts/output"))
LANGUAGE = os.environ.get("XTTS_UK_LANGUAGE", "uk")
DEVICE = os.environ.get("XTTS_UK_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
HOST = os.environ.get("XTTS_UK_HOST", "0.0.0.0")
PORT = int(os.environ.get("XTTS_UK_PORT", "8020"))

app = FastAPI(title="XTTS v2 Ukrainian", version="1.0.0")
_model: Xtts | None = None
_config: XttsConfig | None = None


def _resolve_speaker_wav(speaker: str | None, upload: UploadFile | None) -> Path:
    if upload is not None:
        suffix = Path(upload.filename or "speaker.wav").suffix or ".wav"
        target = OUTPUT_DIR / f"_upload_{os.getpid()}{suffix}"
        target.write_bytes(upload.file.read())
        return target

    if not speaker:
        raise HTTPException(status_code=400, detail="speaker or speaker_wav file is required")

    candidate = Path(speaker)
    if not candidate.is_absolute():
        candidate = SPEAKERS_DIR / speaker
    if candidate.is_dir():
        wavs = sorted(candidate.glob("*.wav"))
        if not wavs:
            raise HTTPException(status_code=404, detail=f"No .wav files in speaker folder: {candidate}")
        return wavs[0]
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Speaker reference not found: {candidate}")
    return candidate


def _wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    if audio.ndim > 1:
        audio = audio[:, 0]
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def _load_model() -> tuple[Xtts, XttsConfig]:
    global _model, _config
    if _model is not None and _config is not None:
        return _model, _config

    config_path = CKPT_DIR / "config.json"
    if not config_path.is_file():
        raise RuntimeError(f"Missing config.json in {CKPT_DIR}")

    config = XttsConfig()
    config.load_json(str(config_path))
    model = Xtts.init_from_config(config)
    model.load_checkpoint(
        config,
        checkpoint_dir=str(CKPT_DIR),
        checkpoint_path=str(CKPT_DIR / "best_model.pth"),
        vocab_path=str(CKPT_DIR / "vocab.json"),
        eval=True,
    )
    if DEVICE.startswith("cuda") and torch.cuda.is_available():
        model.cuda()
    else:
        model.cpu()

    _model = model
    _config = config
    return model, config


@app.on_event("startup")
def startup() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    SPEAKERS_DIR.mkdir(parents=True, exist_ok=True)
    _load_model()


@app.get("/health")
def health() -> dict[str, str | bool]:
    ready = _model is not None
    return {
        "status": "ok" if ready else "loading",
        "language": LANGUAGE,
        "device": DEVICE,
        "model_ready": ready,
    }


@app.get("/speakers")
def list_speakers() -> dict[str, list[str]]:
    files = sorted(p.name for p in SPEAKERS_DIR.glob("*.wav"))
    folders = sorted(p.name for p in SPEAKERS_DIR.iterdir() if p.is_dir())
    return {"wav_files": files, "folders": folders}


@app.post("/tts")
async def synthesize(
    text: Annotated[str, Form()],
    speaker: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = None,
    speaker_wav: UploadFile | None = File(None),
) -> Response:
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    model, config = _load_model()
    speaker_path = _resolve_speaker_wav(speaker, speaker_wav)
    lang = (language or LANGUAGE).strip().lower()
    if lang == "ua":
        lang = "uk"

    try:
        outputs = model.synthesize(
            text,
            config,
            speaker_wav=str(speaker_path),
            language=lang,
        )
    except Exception as exc:  # noqa: BLE001 — surface model errors to client
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    wav = outputs["wav"]
    sample_rate = int(getattr(config, "output_sample_rate", 24000))
    return Response(content=_wav_bytes(wav, sample_rate), media_type="audio/wav")


class OpenAISpeechRequest(BaseModel):
    input: str
    voice: str | None = None
    speaker: str | None = None
    language: str = LANGUAGE
    response_format: str = "wav"


@app.post("/v1/audio/speech")
async def openai_speech(payload: OpenAISpeechRequest) -> Response:
    text = payload.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is required")

    speaker = payload.speaker or payload.voice
    model, config = _load_model()
    speaker_path = _resolve_speaker_wav(speaker, None)
    lang = payload.language.strip().lower()
    if lang == "ua":
        lang = "uk"

    outputs = model.synthesize(text, config, speaker_wav=str(speaker_path), language=lang)
    wav = outputs["wav"]
    sample_rate = int(getattr(config, "output_sample_rate", 24000))

    if payload.response_format.lower() != "wav":
        raise HTTPException(status_code=400, detail="Only response_format=wav is supported")

    return Response(content=_wav_bytes(wav, sample_rate), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=HOST, port=PORT, log_level="info")
