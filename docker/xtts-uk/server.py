import io
import os
import uuid
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import Xtts

CKPT_DIR = Path(os.environ.get("XTTS_CHECKPOINT_DIR", "/data/xtts/checkpoints"))
TEMP_DIR = Path(os.environ.get("XTTS_TEMP_DIR", "/data/xtts/temp"))
LANGUAGE = os.environ.get("XTTS_UK_LANGUAGE", "uk")
DEVICE = os.environ.get("XTTS_UK_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
HOST = os.environ.get("XTTS_UK_HOST", "0.0.0.0")
PORT = int(os.environ.get("XTTS_UK_PORT", "8020"))

_model: Xtts | None = None
_config: XttsConfig | None = None


def _normalize_language(language: str | None) -> str:
    lang = (language or LANGUAGE).strip().lower()
    return "uk" if lang == "ua" else lang


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


async def _save_reference(reference: UploadFile) -> Path:
    suffix = Path(reference.filename or "reference.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        suffix = ".wav"

    path = TEMP_DIR / f"{uuid.uuid4().hex}{suffix}"
    data = await reference.read()
    if not data:
        raise HTTPException(status_code=400, detail="reference audio is empty")
    path.write_bytes(data)
    return path


async def _synthesize(text: str, reference_path: Path, language: str | None) -> bytes:
    model, config = _load_model()
    lang = _normalize_language(language)

    try:
        outputs = model.synthesize(
            text,
            config,
            speaker_wav=str(reference_path),
            language=lang,
        )
    except Exception as exc:  # noqa: BLE001 — surface model errors to client
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sample_rate = int(getattr(config, "output_sample_rate", 24000))
    return _wav_bytes(outputs["wav"], sample_rate)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    _load_model()
    yield


app = FastAPI(
    title="XTTS v2 Ukrainian",
    version="2.0.0",
    description="Stateless TTS: every request must include reference audio for voice cloning.",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok" if _model is not None else "loading",
        "language": LANGUAGE,
        "device": DEVICE,
        "model_ready": _model is not None,
    }


@app.post("/tts")
async def synthesize(
    text: str = Form(..., description="Text to synthesize"),
    reference: UploadFile = File(..., description="Reference voice clip (mono 22050 Hz WAV, 6–10 s)"),
    language: str | None = Form(None, description="Language code (default: uk)"),
) -> Response:
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    reference_path = await _save_reference(reference)
    try:
        wav = await _synthesize(text, reference_path, language)
    finally:
        reference_path.unlink(missing_ok=True)

    return Response(content=wav, media_type="audio/wav")


@app.post("/v1/audio/speech")
async def openai_speech(
    input: str = Form(..., description="Text to synthesize"),
    reference: UploadFile = File(..., description="Reference voice clip"),
    language: str | None = Form(None),
    response_format: str = Form("wav"),
) -> Response:
    if response_format.lower() != "wav":
        raise HTTPException(status_code=400, detail="Only response_format=wav is supported")

    text = input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is required")

    reference_path = await _save_reference(reference)
    try:
        wav = await _synthesize(text, reference_path, language)
    finally:
        reference_path.unlink(missing_ok=True)

    return Response(content=wav, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=HOST, port=PORT, log_level="info")
