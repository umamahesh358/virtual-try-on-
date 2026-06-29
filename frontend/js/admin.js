const API_BASE = "http://localhost:8000";

const uploadForm = document.getElementById('uploadForm');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');

const adjustmentPanel = document.getElementById('adjustmentPanel');
const productPreview = document.getElementById('productPreview');
const saveMetaBtn = document.getElementById('saveMetaBtn');
const resetMetaBtn = document.getElementById('resetMetaBtn');
const saveStatus = document.getElementById('saveStatus');

// Sliders
const widthSlider = document.getElementById('widthSlider');
const lengthSlider = document.getElementById('lengthSlider');
const xSlider = document.getElementById('xSlider');
const ySlider = document.getElementById('ySlider');

const widthVal = document.getElementById('widthVal');
const lengthVal = document.getElementById('lengthVal');
const xVal = document.getElementById('xVal');
const yVal = document.getElementById('yVal');

let currentProductId = null;
let originalImgWidth = 0;
let originalImgHeight = 0;

uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(uploadForm);

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Processing...";
    uploadStatus.textContent = "Removing background, please wait...";
    uploadStatus.className = "text-sm font-semibold text-blue-600 mt-2";
    adjustmentPanel.classList.add('hidden');
    saveStatus.textContent = "";

    try {
        const res = await fetch(`${API_BASE}/upload/`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error("Upload failed");

        const data = await res.json();
        const product = data.product;

        uploadStatus.textContent = "Upload successful! Adjust the size now.";
        uploadStatus.className = "text-sm font-semibold text-green-600 mt-2";

        // Setup adjustment panel
        currentProductId = product.product_id;
        setupAdjustmentPanel(product);

    } catch (err) {
        console.error(err);
        uploadStatus.textContent = "Error during upload.";
        uploadStatus.className = "text-sm font-semibold text-red-600 mt-2";
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload & Process";
    }
});

function setupAdjustmentPanel(product) {
    adjustmentPanel.classList.remove('hidden');

    // Reset sliders
    widthSlider.value = 1.0;
    lengthSlider.value = 1.0;
    xSlider.value = 0;
    ySlider.value = 0;

    updateSliderLabels();

    // Load image
    const imgUrl = `${API_BASE}/products/${product.product_id}/image.png?t=${new Date().getTime()}`;
    productPreview.src = imgUrl;

    productPreview.onload = () => {
        // Set a base width so it fits nicely in the preview box
        originalImgWidth = productPreview.naturalWidth;
        originalImgHeight = productPreview.naturalHeight;

        // Base size for preview: make it take roughly 40% of container width
        const previewContainerWidth = document.getElementById('previewContainer').clientWidth;
        const baseWidth = previewContainerWidth * 0.4;
        productPreview.style.width = `${baseWidth}px`;

        applyTransforms();
    };
}

function updateSliderLabels() {
    widthVal.textContent = parseFloat(widthSlider.value).toFixed(2);
    lengthVal.textContent = parseFloat(lengthSlider.value).toFixed(2);
    xVal.textContent = xSlider.value;
    yVal.textContent = ySlider.value;
}

function applyTransforms() {
    const w = widthSlider.value;
    const l = lengthSlider.value;

    // Convert slider percentage to pixels for preview based on image base size
    const previewContainerWidth = document.getElementById('previewContainer').clientWidth;
    const baseWidth = previewContainerWidth * 0.4;

    const offsetXPercent = parseFloat(xSlider.value) / 100;
    const offsetYPercent = parseFloat(ySlider.value) / 100;

    const xPx = baseWidth * offsetXPercent;
    const yPx = baseWidth * offsetYPercent;

    // Note: We use scale() for width and length
    productPreview.style.transform = `translate(${xPx}px, ${yPx}px) scale(${w}, ${l})`;
}

// Bind sliders
[widthSlider, lengthSlider, xSlider, ySlider].forEach(slider => {
    slider.addEventListener('input', () => {
        updateSliderLabels();
        applyTransforms();
        saveStatus.textContent = "";
    });
});

resetMetaBtn.addEventListener('click', () => {
    widthSlider.value = 1.0;
    lengthSlider.value = 1.0;
    xSlider.value = 0;
    ySlider.value = 0;
    updateSliderLabels();
    applyTransforms();
});

saveMetaBtn.addEventListener('click', async () => {
    if (!currentProductId) return;

    saveMetaBtn.disabled = true;
    saveStatus.textContent = "Saving...";
    saveStatus.className = "text-sm font-semibold mt-2 text-blue-600";

    const payload = {
        width_scale: parseFloat(widthSlider.value),
        length_scale: parseFloat(lengthSlider.value),
        offset_x: parseFloat(xSlider.value),
        offset_y: parseFloat(ySlider.value)
    };

    try {
        const res = await fetch(`${API_BASE}/product/${currentProductId}/metadata`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("Save failed");

        saveStatus.textContent = "Adjustments saved successfully! Ready for try-on.";
        saveStatus.className = "text-sm font-semibold mt-2 text-green-600";

    } catch (err) {
        console.error(err);
        saveStatus.textContent = "Error saving adjustments.";
        saveStatus.className = "text-sm font-semibold mt-2 text-red-600";
    } finally {
        saveMetaBtn.disabled = false;
    }
});
