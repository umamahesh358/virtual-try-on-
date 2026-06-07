# Virtual Try-On (VTO) Jewelry Platform

A zero-fee, open-source, web-based virtual try-on platform for jewelry. This platform allows users to try on rings, earrings, necklaces, chokers, nose rings (naths), bangles, maang tikkas, and waist jewelry directly in their web browser without the need for expensive 3D rendering APIs or native mobile apps.

## Features

* **Multi-Category Support:** Real-time VTO for 8 distinct jewelry types.
* **Hybrid 4-View Engine:** Faux-3D experience by seamlessly swapping between front, back, left, and right product images based on the user's viewing angle. Includes a smart fallback to compress/mirror single images if side views are unavailable.
* **Automated Asset Ingestion:** The backend automatically removes backgrounds (via `rembg`) and tightly crops image alpha boundaries (via `OpenCV`) for perfect VTO alignment.
* **Advanced Tracking:** Utilizes Google MediaPipe (Face Mesh, Hand, and Pose) for accurate 3D landmark tracking.
* **Polish & Stability:** Built-in 7-frame temporal smoothing, confidence gating (hides assets on tracking loss), hysteresis for flicker-free texture swapping, and manual UI calibration controls.

## Project Structure

* `/backend` - FastAPI server handling image processing and catalog management.
* `/frontend` - Vanilla JS/HTML/Tailwind application for the live VTO camera feed.
* `/products` - Automatically generated storage for processed assets and metadata.

## Prerequisites

* Python 3.10+
* A modern web browser with camera access

## How to Run the Project

### 1. Start the Backend

The backend handles image uploads, background removal, and serves the product files. It is recommended to use a virtual environment.

```bash
cd backend
pip install -r requirements.txt
./run.sh
# Alternatively: python main.py
```
*The backend will be available at `http://localhost:8000`*

### 2. Start the Frontend

The frontend is a static web application. You can serve it using any simple HTTP server. If you have Python installed, you can use `http.server`:

```bash
cd frontend
python -m http.server 3000
```
*Open your browser and navigate to `http://localhost:3000`*

## How to Add Products

1. You can add products programmatically by sending a `POST` request to `http://localhost:8000/upload/` as `multipart/form-data`.
2. Include the `category` field (e.g., 'Earrings', 'Rings', 'Necklaces').
3. Include the image files in the fields named `front`, `left`, `right`, and `back`. You can upload just `front`, or any combination of the four.
4. The system will process the images, save them to the `/products` directory, and they will immediately appear in the frontend try-on catalog.
