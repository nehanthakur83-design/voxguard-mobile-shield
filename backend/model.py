import torch

from transformers import (
    AutoModelForAudioClassification,
    AutoFeatureExtractor
)

MODEL_NAME = "garystafford/wav2vec2-deepfake-voice-detector"

_device = "cuda" if torch.cuda.is_available() else "cpu"

_model = None
_feature_extractor = None


def load_model():
    """
    Load the Wav2Vec2 deepfake detector once. Safe to call multiple times —
    only loads on the first call. Called explicitly from main.py's startup
    event so the model is ready before the first request instead of being
    lazily (and unpredictably) loaded on request #1.
    """
    global _model, _feature_extractor

    if _model is None:
        _feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_NAME)
        _model = AutoModelForAudioClassification.from_pretrained(MODEL_NAME)
        _model.to(_device)
        _model.eval()

    return _model, _feature_extractor


def is_model_loaded():
    return _model is not None


def analyze_audio(audio):
    """
    Run deepfake detection on already-loaded, 16kHz mono audio (numpy array).

    Responsible ONLY for model inference — F0/MFCC/Mel/spectral extraction
    lives in audio_features.py, not here.
    """
    model, feature_extractor = load_model()

    inputs = feature_extractor(
        audio,
        sampling_rate=16000,
        return_tensors="pt",
        padding=True
    )

    inputs = {k: v.to(_device) for k, v in inputs.items()}

    with torch.inference_mode():
        outputs = model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)

    prob_real = probs[0][0].item()
    prob_fake = probs[0][1].item()

    prediction = "fake" if prob_fake > 0.5 else "real"
    confidence = max(prob_real, prob_fake)

    return {
        "prediction": prediction,
        "confidence": round(confidence, 4),
        "probabilities": {
            "real": round(prob_real, 4),
            "fake": round(prob_fake, 4)
        }
    }
