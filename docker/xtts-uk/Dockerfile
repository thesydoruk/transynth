FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

LABEL description="XTTS v2 Ukrainian TTS API (coqui-tts)"

RUN apt-get update && \
    apt-get install --no-install-recommends -y \
      python3 \
      python3-pip \
      python3-venv \
      ffmpeg \
      libsndfile1 \
      curl \
      git \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel && \
    python3 -m pip install --no-cache-dir \
      torch==2.5.1 \
      torchaudio==2.5.1 \
      --index-url https://download.pytorch.org/whl/cu124 && \
    python3 -m pip install --no-cache-dir \
      coqui-tts==0.27.4 \
      fastapi==0.115.12 \
      "uvicorn[standard]==0.34.2" \
      python-multipart==0.0.20 \
      huggingface_hub==0.30.2 \
      soundfile==0.13.1

COPY entrypoint.sh server.py /app/
RUN chmod +x /app/entrypoint.sh

ENV PYTHONUNBUFFERED=1
WORKDIR /data/xtts

EXPOSE 8020

ENTRYPOINT ["/app/entrypoint.sh"]
