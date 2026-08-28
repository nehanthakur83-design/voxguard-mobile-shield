import numpy as np
import librosa

TARGET_SR = 16000


def load_audio(file_path, sr=TARGET_SR):
    """
    Load an audio file as mono float32 at the target sample rate.

    Raises whatever librosa/soundfile raises on decode failure — the
    caller (main.py) turns that into a clean 422 HTTP error rather than
    letting a stack trace or filesystem path leak to the client.
    """
    audio, loaded_sr = librosa.load(file_path, sr=sr, mono=True)
    return audio, loaded_sr


def get_audio_metadata(audio, sr):
    return {
        "duration": round(float(len(audio) / sr), 3),
        "sample_rate": sr,
        "channels": 1,
        "samples": int(len(audio))
    }


def extract_f0(audio, sr, fmin=None, fmax=None):
    """
    Extract the F0 (fundamental frequency) contour plus summary stats.

    Uses librosa.pyin, which returns NaN for unvoiced frames — those are
    kept as `None` in the JSON-friendly output and excluded from the
    summary statistics.
    """

    if fmin is None:
        fmin = librosa.note_to_hz("C2")

    if fmax is None:
        fmax = librosa.note_to_hz("C7")

    f0, voiced_flag, voiced_prob = librosa.pyin(
        audio,
        fmin=fmin,
        fmax=fmax,
        sr=sr
    )

    times = librosa.times_like(f0, sr=sr)

    valid_f0 = f0[~np.isnan(f0)]

    if valid_f0.size > 0:
        mean_f0 = float(np.mean(valid_f0))
        min_f0 = float(np.min(valid_f0))
        max_f0 = float(np.max(valid_f0))
        std_f0 = float(np.std(valid_f0))
    else:
        mean_f0 = min_f0 = max_f0 = std_f0 = 0.0

    frequency = [
        None if np.isnan(v) else round(float(v), 2)
        for v in f0
    ]

    voiced_percentage = (
        round(float(np.mean(voiced_flag)) * 100, 2)
        if voiced_flag is not None and len(voiced_flag) > 0
        else 0.0
    )

    return {
        "time": [round(float(t), 4) for t in times],
        "frequency": frequency,
        "mean": round(mean_f0, 2),
        "min": round(min_f0, 2),
        "max": round(max_f0, 2),
        "std": round(std_f0, 2),
        "range": round(max_f0 - min_f0, 2) if valid_f0.size > 0 else 0.0,
        "voiced_percentage": voiced_percentage
    }


def extract_mfcc(audio, sr, n_mfcc=20, hop_length=512):
    """Extract MFCCs as a coefficients x frames matrix, with a matching time axis."""

    mfcc = librosa.feature.mfcc(
        y=audio,
        sr=sr,
        n_mfcc=n_mfcc,
        hop_length=hop_length
    )

    times = librosa.frames_to_time(
        np.arange(mfcc.shape[1]),
        sr=sr,
        hop_length=hop_length
    )

    data = [
        [round(float(v), 3) for v in row]
        for row in mfcc
    ]

    return {
        "data": data,
        "coefficients": n_mfcc,
        "time": [round(float(t), 4) for t in times]
    }


def extract_mel_spectrogram(audio, sr, n_mels=64, n_fft=1024, hop_length=256):
    """Extract a Mel spectrogram, convert to dB, with a matching time axis."""

    mel = librosa.feature.melspectrogram(
        y=audio,
        sr=sr,
        n_mels=n_mels,
        n_fft=n_fft,
        hop_length=hop_length
    )

    mel_db = librosa.power_to_db(mel, ref=np.max)

    times = librosa.frames_to_time(
        np.arange(mel_db.shape[1]),
        sr=sr,
        hop_length=hop_length
    )

    data = [
        [round(float(v), 2) for v in row]
        for row in mel_db
    ]

    return {
        "data": data,
        "mel_bands": n_mels,
        "time": [round(float(t), 4) for t in times]
    }


def extract_spectral_features(audio, sr, n_fft=1024, hop_length=256):
    """
    Frequency-domain forensic metrics (not a replacement for the frontend's
    live FFT visualization — this is the backend, model-supporting layer).
    """

    magnitude = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    if magnitude.size > 0:
        avg_magnitude = np.mean(magnitude, axis=1)
        dominant_idx = int(np.argmax(avg_magnitude))
        dominant_frequency = float(freqs[dominant_idx])
    else:
        dominant_frequency = 0.0

    centroid = librosa.feature.spectral_centroid(y=audio, sr=sr, n_fft=n_fft, hop_length=hop_length)
    bandwidth = librosa.feature.spectral_bandwidth(y=audio, sr=sr, n_fft=n_fft, hop_length=hop_length)
    rolloff = librosa.feature.spectral_rolloff(y=audio, sr=sr, n_fft=n_fft, hop_length=hop_length)
    zcr = librosa.feature.zero_crossing_rate(audio, hop_length=hop_length)

    return {
        "dominant_frequency": round(dominant_frequency, 2),
        "spectral_centroid": round(float(np.mean(centroid)), 2),
        "spectral_bandwidth": round(float(np.mean(bandwidth)), 2),
        "spectral_rolloff": round(float(np.mean(rolloff)), 2),
        "zero_crossing_rate": round(float(np.mean(zcr)), 4)
    }


def analyze_audio_features(audio, sr):
    """
    Run F0, MFCC, Mel spectrogram and spectral analysis on already-loaded
    audio and bundle the results with basic audio metadata.
    """

    return {
        "audio": get_audio_metadata(audio, sr),
        "f0": extract_f0(audio, sr),
        "mfcc": extract_mfcc(audio, sr),
        "mel_spectrogram": extract_mel_spectrogram(audio, sr),
        "spectral": extract_spectral_features(audio, sr)
    }


def sanitize_for_json(obj):
    """
    Recursively replace NaN/Infinity floats with None so the result is
    guaranteed to be valid JSON. Python's `json` module will otherwise
    happily emit literal NaN/Infinity tokens, which most JSON parsers
    (including the browser's JSON.parse) reject.
    """
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    return obj
