FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils libgl1 libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ENV PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
# Importing the app loads the models, which downloads them into the image.
RUN python -c "import app"

EXPOSE 8866
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8866"]
