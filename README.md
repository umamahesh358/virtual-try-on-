# NextGen Jewelry Virtual Try-On (VTO) Platform

A zero-fee, open-source, web-based virtual try-on platform for jewelry. This version introduces a dedicated Admin Panel, allowing store owners to upload 2D jewelry assets and precisely adjust their size and position for perfect live camera alignment.

## Key Features

* **Admin Adjustments:** Upload images, automatically remove backgrounds (via `rembg`), and use a live visual editor to adjust `width`, `length/height`, and `x/y offsets` independently.
* **Proportional Rendering:** Adjustment offsets are calculated proportionally to the detected body landmarks, ensuring that jewelry stays perfectly aligned even as the user moves closer to or further from the camera.
* **Multi-Category Support:** Real-time VTO for Rings, Bangles, Earrings, Necklaces, Chokers, Nose Rings, Maang Tikkas, and Waist Jewelry.
* **Advanced Tracking:** Utilizes Google MediaPipe (Face Mesh, Hand, and Pose) for accurate landmark tracking.
* **Open Source Stack:** Built strictly with Python (FastAPI), OpenCV, rembg, vanilla JS/HTML, and MediaPipe. No paid AR SDKs required.

## Project Structure

* `/backend` - FastAPI server handling image processing (background removal, alpha cropping) and serving product catalog/metadata.
* `/frontend` - Vanilla JS/HTML application containing both the main Try-On Store and the Admin Panel.
* `/products` - Automatically generated local storage for processed assets and their JSON configuration files.

## Prerequisites

* Python 3.10+
* A modern web browser with camera access

## Quick Start

1. Clone the repository.
2. Install the backend dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Run the integrated start script (from the project root or the `backend` directory):
   ```bash
   ./backend/run.sh
   ```

The script will automatically start:
* **Backend API:** `http://localhost:8000`
* **Storefront (Try-On):** `http://localhost:3000`
* **Admin Panel:** `http://localhost:3000/admin`

## Workflow

1. Open `http://localhost:3000/admin`.
2. Select a category and upload a 2D jewelry image.
3. Wait for the background to be removed.
4. Use the sliders to adjust the item's width, length, and positioning offsets. Click **Save Adjustments**.
5. Navigate to `http://localhost:3000` and select the item from the catalog to try it on live!
