"""
Aggregates deepfake-model results across multiple analysis windows into a
single risk assessment.

Does NOT replace or re-weight the deepfake model's own probability for any
single window — the model remains the primary signal per window. This module
only combines *already-computed* window probabilities.

Supports rolling/overlapping windows (e.g. a 5s window re-analyzed every
2-3s) as well as the simpler disjoint-window case — see aggregate_results().
"""

# Centralized, easy-to-tune risk thresholds (upper bound of each band, in %)
RISK_THRESHOLDS = {
    "LOW": 30,
    "MEDIUM": 60,
    "HIGH": 85,
    "CRITICAL": 100,
}

# How quickly older windows lose influence in the rolling aggregate.
# Closer to 1.0 = flatter weighting (older windows still matter).
# Closer to 0.0 = only the most recent windows matter.
DEFAULT_RECENCY_DECAY = 0.85


def classify_risk(percentage):
    """Map an AI-probability percentage (0-100) to a risk level label."""
    if percentage < RISK_THRESHOLDS["LOW"]:
        return "LOW"
    if percentage < RISK_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    if percentage < RISK_THRESHOLDS["HIGH"]:
        return "HIGH"
    return "CRITICAL"


def _recency_weights(n, decay=DEFAULT_RECENCY_DECAY):
    """Later windows (by index, after sorting by start_time) get more weight."""
    raw = [decay ** (n - 1 - i) for i in range(n)]
    total = sum(raw)
    return [w / total for w in raw]


def aggregate_results(window_results, decay=DEFAULT_RECENCY_DECAY):
    """
    Aggregate AI-probability across multiple analysis windows.

    window_results: list of dicts, each with at least:
        - "probabilities": {"real": float, "fake": float}
        - "start_time": float
      (window / end_time / prediction / confidence are passed through if present)

    Rolling windows overlap in time, so they are NOT independent samples of
    disjoint audio — a plain average would let a single stale window drag
    the result down even after the signal has clearly shifted. Instead:

    1. Recency weighting: windows are sorted by start_time and weighted so
       more recent windows (which reflect the current voice activity) count
       more than older ones. This gives faster detection as new windows
       arrive, matching the rolling-window goal of responsiveness.

    2. Consistency check: if consecutive windows largely agree with each
       other, we lean further into the recency-weighted estimate (more
       confidence). If they disagree a lot (noisy / borderline audio), we
       pull the result back toward the plain mean instead of trusting the
       most recent window alone. This gives the "more stable results" the
       overlapping-window approach is meant to provide.

    Returns:
        {
            "windows_analyzed": int,
            "overall_ai_probability": float (0-1),
            "risk_level": str,
            "window_results": [...]  # input windows, sorted by start_time
        }
    """
    if not window_results:
        return {
            "windows_analyzed": 0,
            "overall_ai_probability": 0.0,
            "risk_level": "LOW",
            "window_results": []
        }

    ordered = sorted(window_results, key=lambda w: w.get("start_time", 0))
    fake_probs = [w["probabilities"]["fake"] for w in ordered]

    n = len(fake_probs)

    if n == 1:
        overall = fake_probs[0]
    else:
        weights = _recency_weights(n, decay=decay)
        weighted_mean = sum(p * w for p, w in zip(fake_probs, weights))

        diffs = [abs(fake_probs[i] - fake_probs[i - 1]) for i in range(1, n)]
        avg_diff = sum(diffs) / len(diffs)

        # agreement in [0, 1]: 1 = windows fully agree, 0 = highly volatile
        agreement = max(0.0, min(1.0, 1 - (avg_diff / 0.5)))

        plain_mean = sum(fake_probs) / n
        overall = (
            weighted_mean * (0.5 + 0.5 * agreement)
            + plain_mean * (0.5 - 0.5 * agreement)
        )

    overall = max(0.0, min(1.0, overall))
    overall_pct = round(overall * 100, 2)

    return {
        "windows_analyzed": n,
        "overall_ai_probability": round(overall, 4),
        "risk_level": classify_risk(overall_pct),
        "window_results": ordered
    }
