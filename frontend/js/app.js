// Configuration and State
const API_BASE = "http://localhost:8000";
let activeProduct = null;
let currentViews = {}; // loaded images for active product
let currentViewName = "front";

// Calibration offsets
let calibX = 0, calibY = 0, calibScale = 1.0;

// Camera state
let currentStream = null;
let currentFacingMode = "user"; // "user" or "environment"
let isRenderLoopRunning = false;
const video = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
let videoWidth, videoHeight;

// MediaPipe state
let vision = null;
let handLandmarker = null;
let faceLandmarker = null;
let poseLandmarker = null;
let lastVideoTime = -1;
let isTrackingReady = false;

// Temporal smoothing buffers & State
const SMOOTH_FRAMES = 7;
let smoothingBuffers = {};
const CONFIDENCE_THRESHOLD = 0.75;

// Physics / Hysteresis State
let physicsState = {
    leftEar: { angle: 0, velocity: 0 },
    rightEar: { angle: 0, velocity: 0 }
};
let currentHeadTurn = 0; // -1 to 1

// DOM Elements
const statusMsg = document.getElementById('statusMsg');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const calibrationControls = document.getElementById('calibrationControls');
const uploadForm = document.getElementById('uploadForm');
const uploadStatus = document.getElementById('uploadStatus');
const catalogList = document.getElementById('catalogList');

// Initialize
async function init() {
    await setupCamera();
    await loadMediaPipeTasks();
    await fetchCatalog();

    // Bind form submission
    uploadForm.addEventListener('submit', handleUpload);

    // Resize handling
    window.addEventListener('resize', resizeCanvas);
}

// ------------------- Camera Logic -------------------

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

            // Adjust mirror effect based on facing mode
            if (currentFacingMode === "user") {
                video.style.transform = "scaleX(-1)";
                canvasElement.style.transform = "scaleX(-1)";
            } else {
                video.style.transform = "scaleX(1)";
                canvasElement.style.transform = "scaleX(1)";
            }

            if (isTrackingReady) {
                statusMsg.textContent = "Ready.";
            } else {
                statusMsg.textContent = "Loading tracking models...";
            }

            // Start render loop
            if (!isRenderLoopRunning) {
                isRenderLoopRunning = true;
                window.requestAnimationFrame(renderLoop);
            }
        };
    } catch (err) {
        console.error("Error accessing camera:", err);
        statusMsg.textContent = "Camera error: " + err.message;
    }
}

async function checkCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (videoDevices.length > 1) {
            switchCameraBtn.classList.remove('hidden');
            switchCameraBtn.onclick = () => {
                currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
                setupCamera();
            };
        }
    } catch (err) {
        console.error("Error checking devices:", err);
    }
}

function resizeCanvas() {
    if (!videoWidth) return;
    const container = document.getElementById('videoContainer');
    const rect = container.getBoundingClientRect();

    // Maintain aspect ratio while filling container
    canvasElement.width = videoWidth;
    canvasElement.height = videoHeight;
}

// ------------------- MediaPipe Initialization -------------------

async function loadMediaPipeTasks() {
    const visionBundle = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    try {
        // Initialize Hand Landmarker
        handLandmarker = await HandLandmarker.createFromOptions(visionBundle, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: CONFIDENCE_THRESHOLD,
            minHandPresenceConfidence: CONFIDENCE_THRESHOLD,
            minTrackingConfidence: CONFIDENCE_THRESHOLD
        });

        // Initialize Face Landmarker
        faceLandmarker = await FaceLandmarker.createFromOptions(visionBundle, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "GPU"
            },
            outputFaceBlendshapes: false,
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: CONFIDENCE_THRESHOLD,
            minFacePresenceConfidence: CONFIDENCE_THRESHOLD,
            minTrackingConfidence: CONFIDENCE_THRESHOLD
        });

        // Initialize Pose Landmarker
        poseLandmarker = await PoseLandmarker.createFromOptions(visionBundle, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: CONFIDENCE_THRESHOLD,
            minPosePresenceConfidence: CONFIDENCE_THRESHOLD,
            minTrackingConfidence: CONFIDENCE_THRESHOLD
        });

        isTrackingReady = true;
        if (videoWidth) statusMsg.textContent = "Ready.";
    } catch (err) {
        console.error("Failed to load models:", err);
        statusMsg.textContent = "Failed to load tracking models.";
    }
}

// ------------------- Main Render Loop -------------------

async function renderLoop() {
    if (!isTrackingReady || !videoWidth) {
        window.requestAnimationFrame(renderLoop);
        return;
    }

    let startTimeMs = performance.now();

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;

        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        if (activeProduct && activeProduct.category) {
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

// ------------------- Tracking & Smoothing -------------------

function applySmoothing(key, rawX, rawY, rawWidth, rawRotation) {
    if (!smoothingBuffers[key]) {
        smoothingBuffers[key] = [];
    }

    let buffer = smoothingBuffers[key];
    buffer.push({x: rawX, y: rawY, w: rawWidth, r: rawRotation});
    if (buffer.length > SMOOTH_FRAMES) {
        buffer.shift();
    }

    let sumX = 0, sumY = 0, sumW = 0, sumR = 0;
    buffer.forEach(p => {
        sumX += p.x; sumY += p.y; sumW += p.w; sumR += p.r;
    });

    let n = buffer.length;
    return {
        x: sumX / n,
        y: sumY / n,
        w: sumW / n,
        r: sumR / n
    };
}

// Determines which texture to use based on turn ratio, with hysteresis
function determineView(turnRatio, hasLeft, hasRight) {
    const HYSTERESIS = 0.1;

    if (turnRatio > 0.3 + HYSTERESIS && hasRight) {
        currentViewName = "right";
    } else if (turnRatio < -0.3 - HYSTERESIS && hasLeft) {
        currentViewName = "left";
    } else if (Math.abs(turnRatio) < 0.3) {
        currentViewName = "front";
    }
    // else keep currentViewName to prevent flicker

    return currentViews[currentViewName] || currentViews['front'];
}

function getTexture(viewName) {
    if (currentViews[viewName]) return currentViews[viewName];
    return currentViews['front']; // fallback
}

// ------------------- Specific Placement Logic -------------------

function drawAsset(x, y, width, rotation, img, opacity = 1.0, mirror = false) {
    if (!img) return;

    const aspect = img.height / img.width;
    const height = width * aspect;

    // Apply manual calibration
    x += calibX * canvasElement.width;
    y += calibY * canvasElement.height;
    width *= calibScale;
    const finalHeight = width * aspect;

    canvasCtx.save();
    canvasCtx.globalAlpha = opacity;
    canvasCtx.translate(x, y);
    canvasCtx.rotate(rotation);
    if (mirror) {
        canvasCtx.scale(-1, 1);
    }
    canvasCtx.drawImage(img, -width/2, -finalHeight/2, width, finalHeight);
    canvasCtx.restore();
}

function processHandResults(landmarks, category) {
    if (category === "Rings") {
        let p1 = landmarks[9]; // Middle finger MCP
        let p2 = landmarks[10]; // Middle finger PIP

        let cx = (p1.x + p2.x) / 2 * canvasElement.width;
        let cy = (p1.y + p2.y) / 2 * canvasElement.height;

        let dx = (p2.x - p1.x) * canvasElement.width;
        let dy = (p2.y - p1.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx) - Math.PI/2;

        let segmentLen = Math.hypot(dx, dy);
        let width = segmentLen * 1.5;

        let smoothed = applySmoothing('ring_finger', cx, cy, width, rot);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, getTexture('front'));
    }
    else if (category === "Bangles") {
        let p0 = landmarks[0]; // Wrist

        let cx = p0.x * canvasElement.width;
        let cy = p0.y * canvasElement.height;

        // Rough estimate of wrist orientation using 0 to 9 vector
        let p9 = landmarks[9];
        let dx = (p9.x - p0.x) * canvasElement.width;
        let dy = (p9.y - p0.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx) - Math.PI/2;

        let width = Math.hypot(dx, dy) * 1.2;

        let smoothed = applySmoothing('bangle_wrist', cx, cy, width, rot);

        // Render back layer first if available, then front layer, to create depth
        if (currentViews['back']) {
            drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, currentViews['back']);
        }
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, getTexture('front'));
    }
}

function processFaceResults(landmarks, category) {
    // Calculate head turn ratio
    let leftEar = landmarks[234];
    let rightEar = landmarks[454];
    let nose = landmarks[1];

    let faceWidth = Math.abs(rightEar.x - leftEar.x);
    let turnRatio = (nose.x - ((leftEar.x + rightEar.x) / 2)) / (faceWidth / 2);

    let hasLeft = !!currentViews['left'];
    let hasRight = !!currentViews['right'];
    let viewImg = determineView(turnRatio, hasLeft, hasRight);

    // Head tilt (roll)
    let dx = (rightEar.x - leftEar.x) * canvasElement.width;
    let dy = (rightEar.y - leftEar.y) * canvasElement.height;
    let headRoll = Math.atan2(dy, dx);

    if (category === "Nose Rings") {
        let p = landmarks[129]; // Left nostril edge roughly
        // Adjust anchor based on turn to look right
        if (turnRatio > 0.3) p = landmarks[358]; // Right nostril edge

        let cx = p.x * canvasElement.width;
        let cy = p.y * canvasElement.height;

        let width = faceWidth * canvasElement.width * 0.3; // Scale relative to face

        let smoothed = applySmoothing('nose_ring', cx, cy, width, headRoll);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, viewImg);
    }
    else if (category === "Earrings") {
        const spring = 0.1;
        const friction = 0.8;

        let width = faceWidth * canvasElement.width * 0.3;

        // Draw Left Earring
        if (turnRatio < 0.5) { // Hide if turned too far right
            let forceL = (headRoll - physicsState.leftEar.angle) * spring;
            physicsState.leftEar.velocity += forceL;
            physicsState.leftEar.velocity *= friction;
            physicsState.leftEar.angle += physicsState.leftEar.velocity;

            let lEar = landmarks[132]; // Left earlobe
            let smoothedL = applySmoothing('left_ear', lEar.x * canvasElement.width, lEar.y * canvasElement.height, width, physicsState.leftEar.angle);
            drawAsset(smoothedL.x, smoothedL.y, smoothedL.w, smoothedL.r, viewImg);
        }

        // Draw Right Earring
        if (turnRatio > -0.5) { // Hide if turned too far left
            let forceR = (-headRoll - physicsState.rightEar.angle) * spring; // Inverse swing target
            physicsState.rightEar.velocity += forceR;
            physicsState.rightEar.velocity *= friction;
            physicsState.rightEar.angle += physicsState.rightEar.velocity;

            let rEar = landmarks[361]; // Right earlobe
            let smoothedR = applySmoothing('right_ear', rEar.x * canvasElement.width, rEar.y * canvasElement.height, width, physicsState.rightEar.angle);

            // Mirror texture if it's front view
            let shouldMirror = currentViewName === "front";
            drawAsset(smoothedR.x, smoothedR.y, smoothedR.w, smoothedR.r, viewImg, 1.0, shouldMirror);
        }
    }
    else if (category === "Chokers") {
        let chin = landmarks[152];
        let jawLeft = landmarks[132];
        let jawRight = landmarks[361];

        let cx = chin.x * canvasElement.width;
        let cy = chin.y * canvasElement.height + (0.05 * canvasElement.height); // Shift slightly below chin

        let jawSpan = Math.hypot(
            (jawRight.x - jawLeft.x) * canvasElement.width,
            (jawRight.y - jawLeft.y) * canvasElement.height
        );
        let width = jawSpan * 1.1; // Lock to jawline span

        let smoothed = applySmoothing('choker', cx, cy, width, headRoll);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, viewImg);
    }
    else if (category === "Maang Tikka") {
        let hairline = landmarks[10]; // Top forehead
        let browBridge = landmarks[9]; // Between eyes

        let cx = hairline.x * canvasElement.width;
        let cy = hairline.y * canvasElement.height;

        // Vector from hairline to brow
        let dy = (browBridge.y - hairline.y) * canvasElement.height;
        let dx = (browBridge.x - hairline.x) * canvasElement.width;
        let rot = Math.atan2(dy, dx) - Math.PI/2;

        let width = faceWidth * canvasElement.width * 0.4;

        let smoothed = applySmoothing('maang_tikka', cx, cy, width, rot);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, viewImg);
    }
}

function processPoseResults(landmarks, category) {
    let leftShoulder = landmarks[11];
    let rightShoulder = landmarks[12];

    // Body turn ratio estimation
    let turnRatio = (leftShoulder.z - rightShoulder.z);

    let hasLeft = !!currentViews['left'];
    let hasRight = !!currentViews['right'];
    let viewImg = determineView(turnRatio, hasLeft, hasRight);

    if (category === "Necklaces") {
        let cx = (leftShoulder.x + rightShoulder.x) / 2 * canvasElement.width;
        let cy = (leftShoulder.y + rightShoulder.y) / 2 * canvasElement.height;

        cy += 0.08 * canvasElement.height; // Offset down

        let dx = (rightShoulder.x - leftShoulder.x) * canvasElement.width;
        let dy = (rightShoulder.y - leftShoulder.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx);

        let width = Math.hypot(dx, dy) * 0.9; // Scale to shoulder width

        let smoothed = applySmoothing('necklace', cx, cy, width, rot);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, viewImg);
    }
    else if (category === "Waist Jewelry") {
        let leftHip = landmarks[23];
        let rightHip = landmarks[24];

        let cx = (leftHip.x + rightHip.x) / 2 * canvasElement.width;
        let cy = (leftHip.y + rightHip.y) / 2 * canvasElement.height;

        let dx = (rightHip.x - leftHip.x) * canvasElement.width;
        let dy = (rightHip.y - leftHip.y) * canvasElement.height;
        let rot = Math.atan2(dy, dx);

        let width = Math.hypot(dx, dy) * 1.5; // Scale to hip width

        let smoothed = applySmoothing('waist', cx, cy, width, rot);
        drawAsset(smoothed.x, smoothed.y, smoothed.w, smoothed.r, viewImg);
    }
}

// ------------------- API & UI Integration -------------------

async function handleUpload(e) {
    e.preventDefault();
    const formData = new FormData(uploadForm);

    uploadStatus.classList.remove('hidden');
    uploadStatus.textContent = "Uploading and processing...";
    uploadStatus.className = "text-sm mt-2 text-blue-600";

    try {
        const res = await fetch(`${API_BASE}/upload/`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (res.ok) {
            uploadStatus.textContent = "Success!";
            uploadStatus.className = "text-sm mt-2 text-green-600";
            uploadForm.reset();
            fetchCatalog(); // Refresh list
        } else {
            throw new Error(data.detail || "Upload failed");
        }
    } catch (err) {
        uploadStatus.textContent = err.message;
        uploadStatus.className = "text-sm mt-2 text-red-600";
    }
}

async function fetchCatalog() {
    try {
        const res = await fetch(`${API_BASE}/catalog/`);
        const items = await res.json();

        catalogList.innerHTML = '';
        if (items.length === 0) {
            catalogList.innerHTML = '<p class="text-sm text-gray-500">No products found.</p>';
            return;
        }

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = "w-full text-left p-2 border rounded hover:bg-gray-50 transition flex items-center gap-3";

            // Try to load a thumbnail
            let thumbUrl = `${API_BASE}/products/${item.product_id}/${item.available_views[0]}.png`;

            btn.innerHTML = `
                <img src="${thumbUrl}" class="w-10 h-10 object-contain bg-gray-200 rounded">
                <div>
                    <div class="font-semibold">${item.category}</div>
                    <div class="text-xs text-gray-500">${item.available_views.join(', ')}</div>
                </div>
            `;

            btn.onclick = () => selectProduct(item);
            catalogList.appendChild(btn);
        });
    } catch (err) {
        catalogList.innerHTML = `<p class="text-sm text-red-500">Failed to load catalog.</p>`;
    }
}

async function selectProduct(item) {
    activeProduct = item;
    resetCalibration();
    smoothingBuffers = {}; // clear tracking history
    currentViewName = "front";

    // Load images
    currentViews = {};
    const promises = item.available_views.map(view => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                currentViews[view] = img;
                resolve();
            };
            img.src = `${API_BASE}/products/${item.product_id}/${view}.png`;
        });
    });

    statusMsg.textContent = `Loading ${item.category}...`;
    await Promise.all(promises);
    statusMsg.textContent = `Active: ${item.category}`;
    calibrationControls.classList.remove('hidden');
}

// ------------------- Calibration -------------------

window.calibrate = function(action) {
    const step = 0.01;
    switch(action) {
        case 'up': calibY -= step; break;
        case 'down': calibY += step; break;
        case 'left': calibX -= step; break;
        case 'right': calibX += step; break;
        case 'scaleUp': calibScale += 0.05; break;
        case 'scaleDown': calibScale -= 0.05; break;
    }
}

window.resetCalibration = function() {
    calibX = 0;
    calibY = 0;
    calibScale = 1.0;
}

// Boot
init();
