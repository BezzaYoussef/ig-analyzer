FROM python:3.10-slim

WORKDIR /app

# Install OS dependencies needed by OpenCV and DeepFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-warm DeepFace models at build time so first request is instant
# Downloads the gender model weights into the image layer
RUN python -c "\
    from deepface import DeepFace; \
    import numpy as np; \
    dummy = np.zeros((224, 224, 3), dtype=np.uint8); \
    import cv2, tempfile, os; \
    tmp = tempfile.mktemp(suffix='.png'); \
    cv2.imwrite(tmp, dummy); \
    try: DeepFace.analyze(tmp, actions=['gender'], enforce_detection=False, silent=True); \
    except: pass; \
    os.remove(tmp); \
    print('Models pre-warmed OK')"

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
