import base64
import tempfile
import os
import logging
from fastapi import FastAPI
from pydantic import BaseModel
from deepface import DeepFace

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="DeepFace Gender Service")


class AnalyzeRequest(BaseModel):
    image_b64: str  # base64-encoded PNG/JPEG


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    tmp_path = None
    try:
        # Decode base64 image to a temp file
        image_bytes = base64.b64decode(req.image_b64)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        logger.info(f"Analyzing image ({len(image_bytes) // 1024}KB)...")

        result = DeepFace.analyze(
            img_path=tmp_path,
            actions=["gender"],
            detector_backend="opencv",   # Lightweight & fast
            enforce_detection=False,     # Don't crash if no face clearly found
            silent=True,
        )

        # result is a list of face analyses
        if not result:
            return {"face_detected": False, "reason": "No face found"}

        face = result[0]
        dominant_gender = face.get("dominant_gender", "")  # "Man" or "Woman"
        gender_scores = face.get("gender", {})

        if dominant_gender not in ("Man", "Woman"):
            return {"face_detected": False, "reason": "Could not determine gender"}

        confidence = gender_scores.get(dominant_gender, 0.0)
        logger.info(f"Result: {dominant_gender} ({confidence:.1f}%)")

        return {
            "face_detected": True,
            "gender": dominant_gender,       # "Man" or "Woman"
            "confidence": round(confidence, 1),
        }

    except Exception as e:
        logger.error(f"DeepFace error: {e}")
        return {"face_detected": False, "reason": str(e)[:200]}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
