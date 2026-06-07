import requests
import glob

images = glob.glob("/app/Screenshot*.png")
print("Found images:", images)

# Create a session to use multipart properly
for img in images:
    print(f"Uploading {img}...")
    with open(img, 'rb') as f:
        # The API expects form parameters named 'front', 'back', 'left', or 'right' for images
        files = {'front': (img, f, 'image/png')}
        data = {'category': 'Earrings'}
        try:
            r = requests.post("http://localhost:8000/upload/", files=files, data=data)
            print(r.status_code, r.text)
        except Exception as e:
            print("Error:", e)
