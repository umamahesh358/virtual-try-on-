const API_BASE = "http://localhost:8000";

let activeProduct = null;
let activeImage = null;

// Camera state
let currentStream = null;
let currentFacingMode = "user";
let isRenderLoopRunning = false;
const video = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
let videoWidth, videoHeight;

// MediaPipe state
let handLandmarker = null;
let faceLandmarker = null;
let poseLandmarker = null;
let lastVideoTime = -1;
let isTrackingReady = false;

// Temporal smoothing
const SMOOTH_FRAMES = 5;
let smoothingBuffers = {};
const CONFIDENCE_THRESHOLD = 0.70;

const statusMsg = document.getElementById('statusMsg');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const catalogList = document.getElementById('catalogList');

async function init() {
    await fetchCatalog();
    await setupCamera();
    await loadMediaPipeTasks();
    window.addEventListener('resize', resizeCanvas);
}

// --- Camera ---

async function setupCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 640 },
            height: { ideal: 480 }
        }
    };

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = currentStream;

        video.onloadeddata = () => {
            videoWidth = video.videoWidth;
            videoHeight = video.videoHeight;
            resizeCanvas();
            checkCameras();

            if (currentFacingMode === "user") {
                video.style.transform = "scaleX(-1)";
                canvasElement.style.transform = "scaleX(-1)";
            } else {
                video.style.transform = "scaleX(1)";
                canvasElement.style.transform = "scaleX(1)";
            }

            if (isTrackingReady) {
                statusMsg.textContent = "Ready.";
            }

            if (!isRenderLoopRunning) {
                isRenderLoopRunning = true;
                window.requestAnimationFrame(renderLoop);
            }
        };
    } catch (err) {
        statusMsg.textContent = "Camera error: " + err.message;
    }
}

async function checkCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    if (videoDevices.length > 1) {
        switchCameraBtn.classList.remove('hidden');
        switchCameraBtn.onclick = () => {
            currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
            setupCamera();
        };
    }
}

function resizeCanvas() {
    if (!videoWidth) return;
    canvasElement.width = videoWidth;
    canvasElement.height = videoHeight;
}

// --- MediaPipe ---

async function loadMediaPipeTasks() {
    statusMsg.textContent = "Loading AI models...";
    const visionBundle = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(visionBundle, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 1
    });

    handLandmarker = await HandLandmarker.createFromOptions(visionBundle, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
    });

    poseLandmarker = await PoseLandmarker.createFromOptions(visionBundle, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
    });

    isTrackingReady = true;
    if (videoWidth) statusMsg.textContent = "Ready. Please select a product.";
}

// --- Render Loop ---

async function renderLoop() {
    if (!isTrackingReady || !videoWidth) {
        window.requestAnimationFrame(renderLoop);
        return;
    }

    let startTimeMs = performance.now();

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (activeProduct && activeImage) {
            const cat = activeProduct.category;

            if (["Rings", "Bangles"].includes(cat)) {
                let handResults = handLandmarker.detectForVideo(video, startTimeMs);
                if (handResults.landmarks && handResults.landmarks.length > 0) {
                    processHandResults(handResults.landmarks[0], cat);
                } else {
                    smoothingBuffers = {};
                }
            }
            else if (["Earrings", "Chokers", "Nose Rings", "Maang Tikka"].includes(cat)) {
                let faceResults = faceLandmarker.detectForVideo(video, startTimeMs);
                if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
                    processFaceResults(faceResults.faceLandmarks[0], cat);
                } else {
                    smoothingBuffers = {};
                }
            }
            else if (["Necklaces", "Waist Jewelry"].includes(cat)) {
                let poseResults = poseLandmarker.detectForVideo(video, startTimeMs);
                if (poseResults.landmarks && poseResults.landmarks.length > 0) {
                    processPoseResults(poseResults.landmarks[0], cat);
                } else {
                    smoothingBuffers = {};
                }
            }
        }
    }

    window.requestAnimationFrame(renderLoop);
}

function applySmoothing(key, rawX, rawY, rawWidth, rawRotation) {
    if (!smoothingBuffers[key]) {
        smoothingBuffers[key] = [];
    }

    let buffer = smoothingBuffers[key];
    buffer.push({x: rawX, y: rawY, w: rawWidth, r: rawRotation});
    if (buffer.length > SMOOTH_FRAMES) buffer.shift();

    let sumX = 0, sumY = 0, sumW = 0, sumR = 0;
    buffer.forEach(p => { sumX += p.x; sumY += p.y; sumW += p.w; sumR += p.r; });
    let n = buffer.length;

    return { x: sumX/n, y: sumY/n, w: sumW/n, r: sumR/n };
}

// --- Drawing Logic ---

function drawAsset(x, y, baseWidth, rotation, mirror = false) {
    if (!activeImage || !activeProduct) return;

    // 1. Calculate raw dimensions
    const aspect = activeImage.height / activeImage.width;
    let width = baseWidth;
    let height = baseWidth * aspect;

    // 2. Apply Admin's Scale Adjustments (Width & Length independently)
    width *= activeProduct.width_scale || 1.0;
    height *= activeProduct.length_scale || 1.0;

    // 3. Apply Admin's Position Offsets proportionally
    // The admin panel slider goes from -200 to 200, representing roughly percentage points of the object size
    // So 100 on the slider = 100% of the baseWidth offset.
    const offsetXPercent = (activeProduct.offset_x || 0) / 100;
    const offsetYPercent = (activeProduct.offset_y || 0) / 100;

    const pixelOffsetX = baseWidth * offsetXPercent;
    const pixelOffsetY = baseWidth * offsetYPercent;

    // Convert coordinate space offsets relative to the rotation
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    // Apply local offset after rotation
    const adjustedX = x + (pixelOffsetX * cosR - pixelOffsetY * sinR);
    const adjustedY = y + (pixelOffsetX * sinR + pixelOffsetY * cosR);

    canvasCtx.save();
    canvasCtx.translate(adjustedX, adjustedY);
    canvasCtx.rotate(rotation);
    if (mirror) {
        canvasCtx.scale(-1, 1);
    }

    // Draw centered
    canvasCtx.drawImage(activeImage, -width/2, -height/2, width, height);
    canvasCtx.restore();
}

// --- Tracking Processors ---

function processHandResults(landmarks, category) {
    if (category === "Rings") {
        let p1 = landmarks[9]; // Middle MCP
        let p2 = landmarks[10]; // Middle PIP

        let cx = (p1.x + p2.x) / 2 * canvasElement.width;
        let cy = (p1.y + p2.y) / 2 * canvasElement.height;
        let dx = (p2.x - p1.x) * canvasElement.width;
        let dy = (p2.y - p1.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx) - Math.PI/2;

        let width = Math.hypot(dx, dy) * 1.5;
        let s = applySmoothing('ring', cx, cy, width, rot);
        drawAsset(s.x, s.y, s.w, s.r);
    }
    else if (category === "Bangles") {
        let p0 = landmarks[0]; // Wrist
        let p9 = landmarks[9];

        let cx = p0.x * canvasElement.width;
        let cy = p0.y * canvasElement.height;
        let dx = (p9.x - p0.x) * canvasElement.width;
        let dy = (p9.y - p0.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx) - Math.PI/2;

        let width = Math.hypot(dx, dy) * 1.5;
        let s = applySmoothing('bangle', cx, cy, width, rot);
        drawAsset(s.x, s.y, s.w, s.r);
    }
}

function processFaceResults(landmarks, category) {
    let lEar = landmarks[132];
    let rEar = landmarks[361];
    let faceWidth = Math.abs(rEar.x - lEar.x) * canvasElement.width;

    let dx = (rEar.x - lEar.x) * canvasElement.width;
    let dy = (rEar.y - lEar.y) * canvasElement.height;
    let headRoll = Math.atan2(dy, dx);

    if (category === "Earrings") {
        let width = faceWidth * 0.3;

        let sl = applySmoothing('ear_l', lEar.x * canvasElement.width, lEar.y * canvasElement.height, width, headRoll);
        drawAsset(sl.x, sl.y, sl.w, sl.r, false);

        let sr = applySmoothing('ear_r', rEar.x * canvasElement.width, rEar.y * canvasElement.height, width, headRoll);
        drawAsset(sr.x, sr.y, sr.w, sr.r, true); // mirror right earring
    }
    else if (category === "Nose Rings") {
        let p = landmarks[129]; // default left
        let width = faceWidth * 0.3;
        let s = applySmoothing('nose', p.x * canvasElement.width, p.y * canvasElement.height, width, headRoll);
        drawAsset(s.x, s.y, s.w, s.r);
    }
    else if (category === "Chokers") {
        let chin = landmarks[152];
        let cx = chin.x * canvasElement.width;
        let cy = chin.y * canvasElement.height + (0.05 * canvasElement.height);
        let width = faceWidth * 1.1;
        let s = applySmoothing('choker', cx, cy, width, headRoll);
        drawAsset(s.x, s.y, s.w, s.r);
    }
    else if (category === "Maang Tikka") {
        let hairline = landmarks[10];
        let brow = landmarks[9];

        let dy2 = (brow.y - hairline.y) * canvasElement.height;
        let dx2 = (brow.x - hairline.x) * canvasElement.width;
        let rot = Math.atan2(dy2, dx2) - Math.PI/2;

        let width = faceWidth * 0.4;
        let s = applySmoothing('tikka', hairline.x * canvasElement.width, hairline.y * canvasElement.height, width, rot);
        drawAsset(s.x, s.y, s.w, s.r);
    }
}

function processPoseResults(landmarks, category) {
    let ls = landmarks[11];
    let rs = landmarks[12];

    if (category === "Necklaces") {
        let cx = (ls.x + rs.x) / 2 * canvasElement.width;
        let cy = (ls.y + rs.y) / 2 * canvasElement.height + (0.08 * canvasElement.height);

        let dx = (rs.x - ls.x) * canvasElement.width;
        let dy = (rs.y - ls.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx);

        let width = Math.hypot(dx, dy) * 0.9;
        let s = applySmoothing('necklace', cx, cy, width, rot);
        drawAsset(s.x, s.y, s.w, s.r);
    }
    else if (category === "Waist Jewelry") {
        let lh = landmarks[23];
        let rh = landmarks[24];

        let cx = (lh.x + rh.x) / 2 * canvasElement.width;
        let cy = (lh.y + rh.y) / 2 * canvasElement.height;

        let dx = (rh.x - lh.x) * canvasElement.width;
        let dy = (rh.y - lh.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx);

        let width = Math.hypot(dx, dy) * 1.5;
        let s = applySmoothing('waist', cx, cy, width, rot);
        drawAsset(s.x, s.y, s.w, s.r);
    }
}

// --- API & State ---

async function fetchCatalog() {
    try {
        const res = await fetch(`${API_BASE}/catalog/`);
        const items = await res.json();

        catalogList.innerHTML = '';
        if (items.length === 0) {
            catalogList.innerHTML = '<p class="text-sm text-gray-500">No products available.</p>';
            return;
        }

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = "w-full text-left p-3 border rounded-lg hover:bg-purple-50 transition flex items-center gap-4 bg-gray-50";

            let thumbUrl = `${API_BASE}/products/${item.product_id}/image.png`;

            btn.innerHTML = `
                <img src="${thumbUrl}" class="w-12 h-12 object-contain bg-white rounded shadow-sm">
                <div>
                    <div class="font-bold text-gray-800">${item.category}</div>
                    <div class="text-xs text-gray-500">Try it on!</div>
                </div>
            `;

            btn.onclick = () => selectProduct(item);
            catalogList.appendChild(btn);
        });
    } catch (err) {
        catalogList.innerHTML = `<p class="text-sm text-red-500">Failed to load catalog.</p>`;
    }
}

function selectProduct(item) {
    activeProduct = item;
    smoothingBuffers = {};

    const img = new Image();
    img.onload = () => {
        activeImage = img;
        statusMsg.textContent = `Active: ${item.category}`;
    };
    // add timestamp to bypass cache if admin just updated it
    img.src = `${API_BASE}/products/${item.product_id}/image.png?t=${new Date().getTime()}`;
    statusMsg.textContent = `Loading ${item.category}...`;
}

init();
