from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import uuid
import json
import cv2
import numpy as np
from rembg import remove

app = FastAPI(title="Jewelry VTO API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PRODUCTS_DIR = "products"
os.makedirs(PRODUCTS_DIR, exist_ok=True)

app.mount("/products", StaticFiles(directory=PRODUCTS_DIR), name="products")

def crop_to_alpha(img_path):
    # Load image with alpha channel
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4:
        return # Not a valid 4-channel image

    alpha = img[:, :, 3]
    coords = cv2.findNonZero(alpha)
    if coords is not None:
        x, y, w, h = cv2.boundingRect(coords)
        cropped = img[y:y+h, x:x+w]
        cv2.imwrite(img_path, cropped)

@app.post("/upload/")
async def upload_product(
    category: str = Form(...),
    front: UploadFile = File(None),
    back: UploadFile = File(None),
    left: UploadFile = File(None),
    right: UploadFile = File(None)
):
    product_id = str(uuid.uuid4())
    product_path = os.path.join(PRODUCTS_DIR, product_id)
    os.makedirs(product_path, exist_ok=True)

    available_views = []

    for view_name, file_obj in [("front", front), ("back", back), ("left", left), ("right", right)]:
        if file_obj is not None:
            # Read file
            contents = await file_obj.read()
            # Remove background
            output_data = remove(contents)

            # Save raw transparent image
            out_path = os.path.join(product_path, f"{view_name}.png")
            with open(out_path, "wb") as f:
                f.write(output_data)

            # Crop to alpha boundary tightly
            crop_to_alpha(out_path)
            available_views.append(view_name)

    if not available_views:
        # cleanup
        os.rmdir(product_path)
        raise HTTPException(status_code=400, detail="No images provided")

    # Generate metadata.json
    metadata = {
        "product_id": product_id,
        "category": category,
        "available_views": available_views
    }

    with open(os.path.join(product_path, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=4)

    return {"message": "Product uploaded successfully", "product": metadata}

@app.get("/catalog/")
def get_catalog():
    catalog = []
    for d in os.listdir(PRODUCTS_DIR):
        meta_path = os.path.join(PRODUCTS_DIR, d, "metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                catalog.append(json.load(f))
    return catalog

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
