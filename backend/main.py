import serial
import json
import os
import cv2
import numpy as np
import random
import sqlite3
import time
from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO
from skyfield.api import load, EarthSatellite

SERIAL_PORT = 'COM11'
BAUD_RATE = 115200

# Orbit tracking data
line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', load.timescale())

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")
DB_FILE = os.path.join(BASE_DIR, "telemetry.db")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ────────────────────────────────────────────────────────────
# DATABASE INITIALIZATION
# ────────────────────────────────────────────────────────────
def init_db():
    """Creates the SQLite database and telemetry table if it doesn't exist."""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gs_timestamp INTEGER,
            sat_timestamp INTEGER,
            rssi_gs INTEGER,
            rssi_uplink INTEGER,
            rssi_gsn INTEGER,
            obc_temp REAL,
            payload_temp REAL,
            eps_soc REAL,
            eps_v_bat REAL,
            eps_v_3v3 REAL,
            eps_v_5v REAL,
            eps_i_in INTEGER,
            eps_i_out INTEGER,
            eps_i_payload INTEGER,
            eps_i_comms INTEGER,
            eps_temp REAL,
            att_pitch REAL,
            att_roll REAL,
            att_yaw REAL,
            env_pressure REAL,
            env_humidity REAL,
            gps_alt REAL
        )
    ''')
    conn.commit()
    conn.close()
    print("🗄️ Database initialized successfully.")

# Run this immediately on startup
init_db()

# ────────────────────────────────────────────────────────────
# OPENCV — HELPERS
# ────────────────────────────────────────────────────────────
def get_regions(mask, img_shape, min_area_frac=0.005, label='', max_regions=8):
    H, W = img_shape[:2]
    total = H * W
    kernel = np.ones((9, 9), np.uint8)
    
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    regions =[]
    
    for c in contours:
        area = cv2.contourArea(c)
        if area < total * min_area_frac:
            continue
            
        x, y, w, h = cv2.boundingRect(c)
        
        extent = area / float(w * h) if (w * h) > 0 else 0
        area_pct = round(area / total * 100, 2)
        confidence = int(min(99, max(45, (extent * 80) + (area_pct * 1.5))))
        
        regions.append({
            "x": round(x / W, 4), 
            "y": round(y / H, 4),
            "w": round(w / W, 4), 
            "h": round(h / H, 4),
            "area_pct": area_pct,
            "label": label,
            "confidence": confidence
        })
        
    regions.sort(key=lambda r: r["area_pct"], reverse=True)
    return regions[:max_regions]

# ────────────────────────────────────────────────────────────
# OPENCV — RGB ANALYSIS
# ────────────────────────────────────────────────────────────
def cv_analyze_rgb(img_bgr):
    H, W = img_bgr.shape[:2]
    total = H * W
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    veg_mask = cv2.inRange(
        hsv, 
        np.array([35, 40, 40]), 
        np.array([85, 255, 255])
    )
    
    bare_mask = cv2.inRange(
        hsv, 
        np.array([8, 30, 40]), 
        np.array([30, 220, 210])
    )
    
    burn_mask = cv2.erode(
        cv2.inRange(
            hsv, 
            np.array([0, 0, 0]), 
            np.array([180, 255, 55])
        ),
        np.ones((5, 5), np.uint8)
    )
    
    veg_pct = round(cv2.countNonZero(veg_mask) / total * 100, 1)
    bare_pct = round(cv2.countNonZero(bare_mask) / total * 100, 1)
    burn_pct = round(cv2.countNonZero(burn_mask) / total * 100, 1)
    
    b, g, r = cv2.split(img_bgr.astype(np.float32))
    mean_ndvi = round(float(np.mean((g - r) / (g + r + 1e-6))), 3)
    
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = round(cv2.countNonZero(edges) / total * 100, 1)
    
    health = max(0, min(100, round(
        veg_pct * 0.55 +
        max(0, (mean_ndvi + 0.2) / 1.2 * 100) * 0.30 +
        max(0, 100 - bare_pct * 2 - burn_pct * 4) * 0.15, 1
    )))
    
    if health >= 80:
        grade = 'A'
    elif health >= 65:
        grade = 'B'
    elif health >= 50:
        grade = 'C'
    elif health >= 35:
        grade = 'D'
    else:
        grade = 'F'
        
    if burn_pct > 12:
        fire_risk = 'critical'
    elif burn_pct > 5:
        fire_risk = 'high'
    elif burn_pct > 2:
        fire_risk = 'medium'
    else:
        fire_risk = 'low'
        
    if bare_pct > 40 or edge_density > 18:
        defor_risk = 'critical'
    elif bare_pct > 20 or edge_density > 12:
        defor_risk = 'high'
    elif bare_pct > 8:
        defor_risk = 'medium'
    else:
        defor_risk = 'low'
        
    bare_regions = get_regions(bare_mask, img_bgr.shape, label='Cleared/Deforested')
    burn_regions = get_regions(burn_mask, img_bgr.shape, label='Burn Scar')
    
    return dict(
        vegetation_pct=veg_pct, 
        bare_pct=bare_pct, 
        burn_pct=burn_pct,
        ndvi_proxy=mean_ndvi, 
        edge_density=edge_density,
        health_score=health, 
        health_grade=grade,
        fire_risk=fire_risk, 
        deforestation_risk=defor_risk,
        bare_regions=bare_regions, 
        burn_regions=burn_regions,
    )

# ────────────────────────────────────────────────────────────
# OPENCV — ROAD / LOGGING TRACK DETECTION
# ────────────────────────────────────────────────────────────
def cv_detect_roads(img_bgr):
    H, W = img_bgr.shape[:2]
    
    blurred = cv2.GaussianBlur(img_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    
    bare_mask = cv2.inRange(
        hsv, 
        np.array([5, 10, 40]), 
        np.array([35, 220, 255])
    )
    bare_mask_dilated = cv2.dilate(bare_mask, np.ones((15, 15), np.uint8), iterations=2)
    
    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    
    k_h = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
    k_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
    
    tophat = cv2.add(
        cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_h), 
        cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_v)
    )
    
    tophat = cv2.bitwise_and(tophat, tophat, mask=bare_mask_dilated)
    
    edges = cv2.Canny(tophat, 50, 150)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8))
    
    min_len = int(min(H, W) * 0.10)
    
    lines = cv2.HoughLinesP(
        edges, 
        rho=1, 
        theta=np.pi / 180,
        threshold=60, 
        minLineLength=min_len,
        maxLineGap=int(min_len * 0.15)
    )
    
    if lines is None:
        return {
            "road_segments":[], 
            "road_count": 0, 
            "road_coverage_pct": 0.0
        }
        
    segments =[]
    road_pixel_mask = np.zeros((H, W), dtype=np.uint8)
    
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        
        if length < min_len:
            continue
            
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if angle < 5 or angle > 175 or (85 < angle < 95):
            continue
            
        length_pct = round(length / np.sqrt(H**2 + W**2) * 100, 2)
        confidence = int(min(99, max(50, 60 + (length_pct * 1.5))))
        
        segments.append({
            "x1": round(x1 / W, 4), 
            "y1": round(y1 / H, 4),
            "x2": round(x2 / W, 4), 
            "y2": round(y2 / H, 4),
            "length_pct": length_pct,
            "confidence": confidence
        })
        cv2.line(road_pixel_mask, (x1, y1), (x2, y2), 255, thickness=6)
        
    road_coverage = round(cv2.countNonZero(road_pixel_mask) / (H * W) * 100, 2)
    segments.sort(key=lambda s: s["length_pct"], reverse=True)
    
    return {
        "road_segments": segments[:15], 
        "road_count": len(segments),
        "road_coverage_pct": road_coverage
    }

# ────────────────────────────────────────────────────────────
# OPENCV — CHANGE DETECTION
# ────────────────────────────────────────────────────────────
def cv_change_detect(img_a, img_b):
    h = min(img_a.shape[0], img_b.shape[0])
    w = min(img_a.shape[1], img_b.shape[1])
    
    a, b = cv2.resize(img_a, (w, h)), cv2.resize(img_b, (w, h))
    total = h * w
    
    diff = cv2.absdiff(a, b)
    _, thresh = cv2.threshold(cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY), 28, 255, cv2.THRESH_BINARY)
    change_pct = round(cv2.countNonZero(thresh) / total * 100, 1)
    
    def veg_pct(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        return cv2.countNonZero(cv2.inRange(hsv, np.array([35,40,40]), np.array([85,255,255]))) / total * 100
        
    def bare_pct(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        return cv2.countNonZero(cv2.inRange(hsv, np.array([8,30,40]), np.array([30,220,210]))) / total * 100
        
    va, vb = veg_pct(a), veg_pct(b)
    ba, bb = bare_pct(a), bare_pct(b)
    
    bare_after = cv2.inRange(cv2.cvtColor(b, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))
    bare_before = cv2.inRange(cv2.cvtColor(a, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))
    new_bare = cv2.bitwise_and(bare_after, cv2.bitwise_not(bare_before))
    
    change_regions_raw = get_regions(thresh, (h, w), label='Changed area')
    new_bare_regions = get_regions(new_bare, (h, w), label='Newly cleared')
    
    dilated = cv2.dilate(thresh, np.ones((7,7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    n_regions = len([c for c in contours if cv2.contourArea(c) > total * 0.005])
    
    return dict(
        change_pct=change_pct,
        veg_before=round(va, 1), 
        veg_after=round(vb, 1), 
        veg_delta=round(vb - va, 1),
        bare_before=round(ba, 1), 
        bare_after=round(bb, 1), 
        bare_delta=round(bb - ba, 1),
        change_regions=n_regions, 
        change_boxes=change_regions_raw, 
        new_bare_regions=new_bare_regions,
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
    return jsonify(sorted(f for f in os.listdir(SAMPLES_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))))

@app.route('/samples/<path:filename>')
def serve_sample(filename): 
    return send_from_directory(SAMPLES_DIR, filename)

@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    filename = request.get_json().get('filename', '')
    path = os.path.join(SAMPLES_DIR, os.path.basename(filename))
    
    img = cv2.imread(path)
    if img is None: 
        return jsonify({"error": "Could not decode image"}), 500
        
    result = cv_analyze_rgb(img)
    result.update(cv_detect_roads(img))
    result["filename"] = filename
    
    return jsonify(result)

@app.route('/api/compare', methods=['POST'])
def compare_images():
    data = request.get_json()
    pa = os.path.join(SAMPLES_DIR, os.path.basename(data.get('before', '')))
    pb = os.path.join(SAMPLES_DIR, os.path.basename(data.get('after', '')))
    
    ia, ib = cv2.imread(pa), cv2.imread(pb)
    
    if ia is None or ib is None: 
        return jsonify({"error": "Could not read images"}), 500
        
    result = cv_change_detect(ia, ib)
    result.update(before=data.get('before', ''), after=data.get('after', ''))
    
    return jsonify(result)

# NEW: Fetch latest satellite timestamp to sync the UI inputs!
@app.route('/api/latest_time', methods=['GET'])
def get_latest_time():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute('SELECT MAX(sat_timestamp) FROM telemetry')
        row = c.fetchone()
        conn.close()
        latest = row[0] if row[0] else int(time.time())
        return jsonify({"latest_time": latest})
    except Exception as e:
        return jsonify({"latest_time": int(time.time())})

# UPGRADED: Query using sat_timestamp, not the ground station time!
@app.route('/api/history', methods=['GET'])
def get_history():
    start_ts = request.args.get('start', type=int)
    end_ts = request.args.get('end', type=int)
    
    if not start_ts or not end_ts:
        return jsonify({"error": "Please provide start and end timestamps"}), 400
        
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        c.execute('''
            SELECT * FROM telemetry 
            WHERE sat_timestamp >= ? AND sat_timestamp <= ? 
            ORDER BY sat_timestamp ASC 
            LIMIT 1000
        ''', (start_ts, end_ts))
        
        rows = c.fetchall()
        conn.close()
        
        history_data =[dict(row) for row in rows]
        return jsonify(history_data)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_satellite_pos():
    ts = load.timescale()
    geo = satellite.at(ts.now())
    sub = geo.subpoint()
    return sub.latitude.degrees, sub.longitude.degrees

# ────────────────────────────────────────────────────────────
# SERIAL THREAD & DATABASE INJECTION
# ────────────────────────────────────────────────────────────
def read_serial_data():
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n📡 Connected to ESP32 on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        
                        gs_time = int(time.time())
                        sat_time = data.get('timestamp', gs_time)
                        
                        lat, lng = get_satellite_pos()
                        data["lat"] = lat
                        data["lng"] = lng
                        data["rssi_gs"] = random.randint(-85, -60)
                        
                        # ── SAVE TO SQLITE DATABASE ──
                        try:
                            conn = sqlite3.connect(DB_FILE)
                            c = conn.cursor()
                            
                            eps = data.get('eps', {})
                            att = data.get('attitude', {})
                            env = data.get('env', {})
                            gps = data.get('gps', {})
                            
                            c.execute('''
                                INSERT INTO telemetry (
                                    gs_timestamp, sat_timestamp, rssi_gs, rssi_uplink, rssi_gsn,
                                    obc_temp, payload_temp, eps_soc, eps_v_bat, eps_v_3v3, eps_v_5v,
                                    eps_i_in, eps_i_out, eps_i_payload, eps_i_comms, eps_temp,
                                    att_pitch, att_roll, att_yaw, env_pressure, env_humidity, gps_alt
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (
                                gs_time,
                                sat_time,
                                data.get('rssi_gs', 0),
                                data.get('rssi_uplink', 0),
                                data.get('rssi_gsn', 0),
                                data.get('obc_temp', 0.0),
                                data.get('payload_temp', 0.0),
                                eps.get('soc', 0.0),
                                eps.get('v_bat', 0.0),
                                eps.get('v_3v3', 0.0),
                                eps.get('v_5v', 0.0),
                                eps.get('i_in', 0),
                                eps.get('i_out', 0),
                                eps.get('i_payload', 0),
                                eps.get('i_comms', 0),
                                eps.get('temp', 0.0),
                                att.get('pitch', 0.0),
                                att.get('roll', 0.0),
                                att.get('yaw', 0.0),
                                env.get('pressure', 0.0),
                                env.get('humidity', 0.0),
                                gps.get('alt', 0.0)
                            ))
                            conn.commit()
                            conn.close()
                        except Exception as db_err:
                            print(f"Database Insert Error: {db_err}")

                        socketio.emit('telemetry_update', data)
                        
                    except json.JSONDecodeError: 
                        pass
            
            socketio.sleep(0.01)
            
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}")

if __name__ == '__main__':
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)