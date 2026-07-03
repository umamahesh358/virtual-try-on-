from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import os
import uuid
import json
import cv2
from rembg import remove

app = FastAPI(title="Jewelry VTO API - NextGen")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PRODUCTS_DIR = "../products"
os.makedirs(PRODUCTS_DIR, exist_ok=True)

# Mount static directories
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
    image: UploadFile = File(...)
):
    product_id = str(uuid.uuid4())
    product_path = os.path.join(PRODUCTS_DIR, product_id)
    os.makedirs(product_path, exist_ok=True)

    # Read file
    contents = await image.read()

    # Remove background
    output_data = remove(contents)

    # Save raw transparent image
    out_path = os.path.join(product_path, "image.png")
    with open(out_path, "wb") as f:
        f.write(output_data)

    # Crop to alpha boundary tightly for better alignment
    crop_to_alpha(out_path)

    # Generate default metadata.json
    metadata = {
        "product_id": product_id,
        "category": category,
        "width_scale": 1.0,
        "length_scale": 1.0,
        "offset_x": 0.0,
        "offset_y": 0.0
    }

    with open(os.path.join(product_path, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=4)

    return {"message": "Product uploaded successfully", "product": metadata}

class UpdateMetadataRequest(BaseModel):
    width_scale: float
    length_scale: float
    offset_x: float
    offset_y: float

@app.put("/product/{product_id}/metadata")
def update_product_metadata(product_id: str, data: UpdateMetadataRequest):
    product_path = os.path.join(PRODUCTS_DIR, product_id)
    meta_path = os.path.join(product_path, "metadata.json")

    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Product not found")

    with open(meta_path, "r") as f:
        metadata = json.load(f)

    metadata.update({
        "width_scale": data.width_scale,
        "length_scale": data.length_scale,
        "offset_x": data.offset_x,
        "offset_y": data.offset_y
    })

    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=4)

    return {"message": "Metadata updated successfully", "metadata": metadata}

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
