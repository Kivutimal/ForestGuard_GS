import serial
import json
import os
import cv2
import numpy as np
from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO
from skyfield.api import load, EarthSatellite

SERIAL_PORT = 'COM11'
BAUD_RATE   = 115200

line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', load.timescale())

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))
SAMPLES_DIR  = os.path.join(BASE_DIR, "samples")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')


# ────────────────────────────────────────────────────────────
# HELPERS
# ────────────────────────────────────────────────────────────

def get_regions(mask, img_shape, min_area_frac=0.005, label='', max_regions=8):
    """
    Find significant contours in a binary mask and return their
    bounding boxes as normalised coordinates (0.0–1.0) so the
    frontend can draw them at any display size.
    """
    H, W   = img_shape[:2]
    total  = H * W
    kernel = np.ones((9, 9), np.uint8)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < total * min_area_frac:
            continue
        x, y, w, h = cv2.boundingRect(c)
        regions.append({
            "x":     round(x / W, 4),
            "y":     round(y / H, 4),
            "w":     round(w / W, 4),
            "h":     round(h / H, 4),
            "area_pct": round(area / total * 100, 2),
            "label": label
        })

    # Return largest regions first
    regions.sort(key=lambda r: r["area_pct"], reverse=True)
    return regions[:max_regions]


# ────────────────────────────────────────────────────────────
# RGB ANALYSIS
# ────────────────────────────────────────────────────────────

def cv_analyze_rgb(img_bgr):
    H, W  = img_bgr.shape[:2]
    total = H * W
    hsv   = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    veg_mask  = cv2.inRange(hsv, np.array([35, 40, 40]),  np.array([85, 255, 255]))
    bare_mask = cv2.inRange(hsv, np.array([8,  30, 40]),  np.array([30, 220, 210]))
    burn_mask = cv2.erode(
        cv2.inRange(hsv, np.array([0, 0, 0]), np.array([180, 255, 55])),
        np.ones((5, 5), np.uint8))

    veg_pct  = round(cv2.countNonZero(veg_mask)  / total * 100, 1)
    bare_pct = round(cv2.countNonZero(bare_mask)  / total * 100, 1)
    burn_pct = round(cv2.countNonZero(burn_mask)  / total * 100, 1)

    b, g, r   = cv2.split(img_bgr.astype(np.float32))
    mean_ndvi = round(float(np.mean((g - r) / (g + r + 1e-6))), 3)

    gray  = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = round(cv2.countNonZero(edges) / total * 100, 1)

    health = max(0, min(100, round(
        veg_pct  * 0.55 +
        max(0, (mean_ndvi + 0.2) / 1.2 * 100) * 0.30 +
        max(0, 100 - bare_pct * 2 - burn_pct * 4) * 0.15, 1)))

    grade = 'A' if health >= 80 else 'B' if health >= 65 else \
            'C' if health >= 50 else 'D' if health >= 35 else 'F'

    fire_risk  = ('critical' if burn_pct > 12 else 'high' if burn_pct > 5  else
                  'medium'   if burn_pct > 2  else 'low')
    defor_risk = ('critical' if bare_pct > 40 or edge_density > 18 else
                  'high'     if bare_pct > 20 or edge_density > 12 else
                  'medium'   if bare_pct > 8  else 'low')

    # Spatial regions — what the frontend will draw boxes around
    bare_regions = get_regions(bare_mask, img_bgr.shape, label='Cleared/Deforested')
    burn_regions = get_regions(burn_mask, img_bgr.shape, label='Burn Scar')

    return dict(
        vegetation_pct   = veg_pct,
        bare_pct         = bare_pct,
        burn_pct         = burn_pct,
        ndvi_proxy       = mean_ndvi,
        edge_density     = edge_density,
        health_score     = health,
        health_grade     = grade,
        fire_risk        = fire_risk,
        deforestation_risk = defor_risk,
        bare_regions     = bare_regions,
        burn_regions     = burn_regions,
    )


# ────────────────────────────────────────────────────────────
# CHANGE DETECTION
# ────────────────────────────────────────────────────────────

def cv_change_detect(img_a, img_b):
    h = min(img_a.shape[0], img_b.shape[0])
    w = min(img_a.shape[1], img_b.shape[1])
    a, b  = cv2.resize(img_a, (w, h)), cv2.resize(img_b, (w, h))
    total = h * w

    diff      = cv2.absdiff(a, b)
    _, thresh = cv2.threshold(
        cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY), 28, 255, cv2.THRESH_BINARY)
    change_pct = round(cv2.countNonZero(thresh) / total * 100, 1)

    def veg_pct(img):
        hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        return cv2.countNonZero(
            cv2.inRange(hsv, np.array([35,40,40]), np.array([85,255,255]))) / total * 100

    def bare_pct(img):
        hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        return cv2.countNonZero(
            cv2.inRange(hsv, np.array([8,30,40]), np.array([30,220,210]))) / total * 100

    va, vb = veg_pct(a), veg_pct(b)
    ba, bb = bare_pct(a), bare_pct(b)

    # Regions that changed — where bare ground appeared in the "after" image
    bare_after_mask = cv2.inRange(
        cv2.cvtColor(b, cv2.COLOR_BGR2HSV),
        np.array([8,30,40]), np.array([30,220,210]))
    # Only flag pixels that were NOT bare in the before image
    bare_before_mask = cv2.inRange(
        cv2.cvtColor(a, cv2.COLOR_BGR2HSV),
        np.array([8,30,40]), np.array([30,220,210]))
    new_bare = cv2.bitwise_and(bare_after_mask,
                               cv2.bitwise_not(bare_before_mask))

    change_regions_raw = get_regions(thresh, (h, w), label='Changed area')
    new_bare_regions   = get_regions(new_bare, (h, w), label='Newly cleared')

    dilated    = cv2.dilate(thresh, np.ones((7,7), np.uint8), iterations=2)
    contours,_ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    n_regions  = len([c for c in contours if cv2.contourArea(c) > total * 0.005])

    return dict(
        change_pct       = change_pct,
        veg_before       = round(va, 1),
        veg_after        = round(vb, 1),
        veg_delta        = round(vb - va, 1),
        bare_before      = round(ba, 1),
        bare_after       = round(bb, 1),
        bare_delta       = round(bb - ba, 1),
        change_regions   = n_regions,
        change_boxes     = change_regions_raw,
        new_bare_regions = new_bare_regions,
    )


# ────────────────────────────────────────────────────────────
# FLASK ROUTES
# ────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)

@app.route('/api/samples')
def list_samples():
    if not os.path.exists(SAMPLES_DIR):
        return jsonify([])
    files = sorted(f for f in os.listdir(SAMPLES_DIR)
                   if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    return jsonify(files)

@app.route('/samples/<path:filename>')
def serve_sample(filename):
    return send_from_directory(SAMPLES_DIR, filename)

@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    filename = request.get_json().get('filename', '')
    if not filename:
        return jsonify({"error": "No filename"}), 400
    path = os.path.join(SAMPLES_DIR, os.path.basename(filename))
    if not os.path.exists(path):
        return jsonify({"error": f"Not found: {filename}"}), 404
    img = cv2.imread(path)
    if img is None:
        return jsonify({"error": "Could not decode image"}), 500
    result = cv_analyze_rgb(img)
    result["filename"] = filename
    return jsonify(result)

@app.route('/api/compare', methods=['POST'])
def compare_images():
    data   = request.get_json()
    file_a = data.get('before', '')
    file_b = data.get('after',  '')
    if not file_a or not file_b:
        return jsonify({"error": "Need before and after"}), 400
    pa = os.path.join(SAMPLES_DIR, os.path.basename(file_a))
    pb = os.path.join(SAMPLES_DIR, os.path.basename(file_b))
    for p, n in [(pa, file_a), (pb, file_b)]:
        if not os.path.exists(p):
            return jsonify({"error": f"Not found: {n}"}), 404
    ia, ib = cv2.imread(pa), cv2.imread(pb)
    if ia is None or ib is None:
        return jsonify({"error": "Could not read images"}), 500
    result = cv_change_detect(ia, ib)
    result.update(before=file_a, after=file_b)
    return jsonify(result)


# ────────────────────────────────────────────────────────────
# SERIAL + SOCKETIO
# ────────────────────────────────────────────────────────────

def get_satellite_pos():
    ts  = load.timescale()
    geo = satellite.at(ts.now())
    sub = geo.subpoint()
    return sub.latitude.degrees, sub.longitude.degrees

def read_serial_data():
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n🛰️  Connected to ESP32 on {SERIAL_PORT}")
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        lat, lng = get_satellite_pos()
                        data["lat"] = lat
                        data["lng"] = lng
                        socketio.emit('telemetry_update', data)
                    except json.JSONDecodeError:
                        pass
            socketio.sleep(0.01)
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}  (telemetry stream inactive)")

if __name__ == '__main__':
    print("🚀 ForestGuard GS → http://localhost:8000")
    print(f"📁 Samples: {SAMPLES_DIR}")
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)