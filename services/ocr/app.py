from io import BytesIO

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from paddleocr import PaddleOCR
from pdf2image import convert_from_bytes
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

# iPhones send HEIC, which the upload accepts.
register_heif_opener()

# Mobile models and no orientation or unwarping models: the service shares the Docker VM's memory.
# One CPU thread: Paddle 3.2 on aarch64 segfaults in predict with more.
ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="en_PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    cpu_threads=1,
)

app = FastAPI()


def pages(data: bytes) -> list[Image.Image]:
    if data.startswith(b"%PDF"):
        return convert_from_bytes(data, dpi=200)
    try:
        # Phone cameras store the photo unrotated and record the rotation in EXIF.
        return [ImageOps.exif_transpose(Image.open(BytesIO(data)))]
    except UnidentifiedImageError:
        raise HTTPException(status_code=415, detail="Not a PDF or an image format this service reads.")


@app.post("/ocr")
async def read_text(request: Request) -> dict:
    lines = []
    for page in pages(await request.body()):
        for result in ocr.predict(np.ascontiguousarray(np.array(page.convert("RGB"))[:, :, ::-1])):
            lines += [
                {"text": text, "confidence": float(score)}
                for text, score in zip(result["rec_texts"], result["rec_scores"])
            ]
    return {"lines": lines}
