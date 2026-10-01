from io import BytesIO
from threading import Lock

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Request
from paddleocr import PaddleOCR
from pdf2image import convert_from_bytes
from pdf2image.exceptions import PDFPageCountError, PDFSyntaxError
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

# iPhones send HEIC, which the upload accepts.
register_heif_opener()

MAX_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 3

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

# The handlers run in a threadpool, and one model instance is not safe to call from two threads.
predict_lock = Lock()

app = FastAPI()


async def body(request: Request) -> bytes:
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"The upload is over {MAX_BYTES} bytes.")
    return bytes(data)


def pages(data: bytes) -> list[Image.Image]:
    try:
        if data.startswith(b"%PDF"):
            return convert_from_bytes(data, dpi=200, last_page=MAX_PDF_PAGES)
        # Phone cameras store the photo unrotated and record the rotation in EXIF.
        return [ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")]
    except (PDFPageCountError, PDFSyntaxError, UnidentifiedImageError, OSError):
        raise HTTPException(status_code=415, detail="Not a PDF or an image this service can read.")


# A plain `def`, so FastAPI runs the blocking predict in its threadpool.
@app.post("/ocr")
def read_text(data: bytes = Depends(body)) -> dict:
    lines = []
    for page in pages(data):
        with predict_lock:
            results = ocr.predict(np.ascontiguousarray(np.array(page)[:, :, ::-1]))
        for result in results:
            lines += [
                {"text": text, "confidence": float(score)}
                for text, score in zip(result["rec_texts"], result["rec_scores"])
            ]
    return {"lines": lines}
