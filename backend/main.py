import os
import uuid
import logging
from typing import List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from model import analyze_audio, load_model, is_model_loaded
from audio_features import load_audio, analyze_audio_features, sanitize_for_json
import risk_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voxguard")

app = FastAPI(
    title="VoxGuard API",
    description="AI voice deepfake detection and audio-forensics service.",
    version="1.0.0"
)

# Configurable via env var so prod deployments don't need a code change.
# Comma-separated list, e.g. "https://voxguard.app,https://staging.voxguard.app"
ALLOWED_ORIGINS = os.environ.get(
    "VOXGUARD_ALLOWED_ORIGINS",
    "http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"}
MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB


@app.on_event("startup")
def startup_event():
    logger.info("VoxGuard backend starting...")
    logger.info("Loading deepfake model...")
    load_model()
    logger.info("Model loaded successfully.")
    logger.info("Audio analysis engine ready.")
    logger.info("API ready.")


class Probabilities(BaseModel):
    real: float
    fake: float


class WindowResult(BaseModel):
    window: int
    start_time: float
    end_time: float
    prediction: str
    confidence: float
    probabilities: Probabilities


class AggregateRequest(BaseModel):
    windows: List[WindowResult]


@app.get("/")
def root():
    return {"message": "VoxGuard API is running"}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_loaded": is_model_loaded()
    }


def _validate_upload(file: UploadFile, contents: bytes) -> str:
    extension = os.path.splitext(file.filename or "")[1].lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported audio file type.")

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large.")

    return extension


def _save_temp_file(contents: bytes, extension: str) -> str:
    # Server-generated filename only — clients never choose the destination path.
    safe_name = f"{uuid.uuid4().hex}{extension}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as f:
        f.write(contents)

    return file_path


def _load_and_validate_audio(file_path: str):
    try:
        audio, sr = load_audio(file_path)
    except Exception:
        logger.exception("Audio decode failed")
        raise HTTPException(status_code=422, detail="Audio could not be decoded.")

    if audio is None or len(audio) == 0:
        raise HTTPException(status_code=422, detail="Audio could not be decoded.")

    return audio, sr


def _run_full_analysis(audio, sr):
    model_result = analyze_audio(audio)
    features = analyze_audio_features(audio, sr)
    return {**model_result, **features}


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Full analysis of an uploaded audio file: deepfake prediction plus
    F0, MFCC, Mel spectrogram, spectral metrics and audio metadata.
    Preserves the original response shape (success/filename/prediction/
    confidence/probabilities) so the existing frontend keeps working.
    """
    contents = await file.read()
    extension = _validate_upload(file, contents)
    file_path = _save_temp_file(contents, extension)

    try:
        audio, sr = _load_and_validate_audio(file_path)
        result = _run_full_analysis(audio, sr)

        response = {
            "success": True,
            "filename": file.filename,
            "prediction": result["prediction"],
            "confidence": result["confidence"],
            "probabilities": result["probabilities"],
            "audio": result["audio"],
            "f0": result["f0"],
            "mfcc": result["mfcc"],
            "mel_spectrogram": result["mel_spectrogram"],
            "spectral": result["spectral"]
        }

        return sanitize_for_json(response)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail="Analysis failed.")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/analyze-chunk")
async def analyze_chunk(
    file: UploadFile = File(...),
    window: int = Form(1),
    start_time: float = Form(0.0),
    end_time: float = Form(5.0)
):
    """
    Analyze a single short audio chunk — the building block for live-call
    analysis. Each chunk is analyzed independently and statelessly; this
    endpoint makes no assumption about how the client windows the call.

    That means it works equally well for disjoint 5s chunks (0-5, 5-10, ...)
    or for a rolling/overlapping window (e.g. a 5s window re-analyzed every
    2-3s: 0-5, 3-8, 6-11, ...). The client sends whatever start_time/end_time
    it used; the server just reports on the audio it was given.

    Call /api/aggregate-risk with the accumulated window results to combine
    them into a stabilized overall risk assessment.
    """
    contents = await file.read()
    extension = _validate_upload(file, contents)
    file_path = _save_temp_file(contents, extension)

    try:
        audio, sr = _load_and_validate_audio(file_path)
        result = _run_full_analysis(audio, sr)

        response = {
            "success": True,
            "window": window,
            "start_time": start_time,
            "end_time": end_time,
            "duration": result["audio"]["duration"],
            "prediction": result["prediction"],
            "confidence": result["confidence"],
            "probabilities": result["probabilities"],
            "f0": result["f0"],
            "mfcc": result["mfcc"],
            "mel_spectrogram": result["mel_spectrogram"],
            "spectral": result["spectral"]
        }

        return sanitize_for_json(response)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Chunk analysis failed")
        raise HTTPException(status_code=500, detail="Analysis failed.")
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@app.post("/api/aggregate-risk")
async def aggregate_risk(payload: AggregateRequest):
    """
    Combine multiple /api/analyze-chunk results (disjoint or rolling/
    overlapping) into a single overall risk assessment. No server-side
    session state is kept — the client sends the window results it has
    collected so far on every call.
    """
    if not payload.windows:
        raise HTTPException(status_code=400, detail="At least one window result is required.")

    window_dicts = [w.dict() for w in payload.windows]

    try:
        result = risk_engine.aggregate_results(window_dicts)
    except Exception:
        logger.exception("Risk aggregation failed")
        raise HTTPException(status_code=500, detail="Risk aggregation failed.")

    return sanitize_for_json(result)
