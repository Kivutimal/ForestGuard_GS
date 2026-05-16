import serial
import json
import os
import cv2
import numpy as np
import random
from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO
from skyfield.api import load, EarthSatellite, wgs84

# ==============================================================================
# CONFIGURATION
# ==============================================================================
SERIAL_PORT = 'COM11'
BAUD_RATE = 115200

# Orbit tracking data for Skyfield
line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'
ts = load.timescale()
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', ts)

# Target Area for Imaging (MAU FOREST, KENYA)
TARGET_LAT = -0.2325
TARGET_LNG = 35.5523
TARGET_LOCATION = wgs84.latlon(TARGET_LAT, TARGET_LNG)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Global serial object
ser = None

# ==============================================================================
# OPENCV HELPERS
# ==============================================================================
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

def cv_analyze_rgb(img_bgr):
    H, W = img_bgr.shape[:2]
    total = H * W
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    veg_mask = cv2.inRange(hsv, np.array([35, 40, 40]), np.array([85, 255, 255]))
    bare_mask = cv2.inRange(hsv, np.array([8, 30, 40]), np.array([30, 220, 210]))
    burn_mask = cv2.erode(cv2.inRange(hsv, np.array([0, 0, 0]), np.array([180, 255, 55])), np.ones((5, 5), np.uint8))
    
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
    
    if health >= 80: grade = 'A'
    elif health >= 65: grade = 'B'
    elif health >= 50: grade = 'C'
    elif health >= 35: grade = 'D'
    else: grade = 'F'
        
    if burn_pct > 12: fire_risk = 'critical'
    elif burn_pct > 5: fire_risk = 'high'
    elif burn_pct > 2: fire_risk = 'medium'
    else: fire_risk = 'low'
        
    if bare_pct > 40 or edge_density > 18: defor_risk = 'critical'
    elif bare_pct > 20 or edge_density > 12: defor_risk = 'high'
    elif bare_pct > 8: defor_risk = 'medium'
    else: defor_risk = 'low'
        
    bare_regions = get_regions(bare_mask, img_bgr.shape, label='Cleared/Deforested')
    burn_regions = get_regions(burn_mask, img_bgr.shape, label='Burn Scar')
    
    return dict(
        vegetation_pct=veg_pct, bare_pct=bare_pct, burn_pct=burn_pct,
        ndvi_proxy=mean_ndvi, edge_density=edge_density,
        health_score=health, health_grade=grade,
        fire_risk=fire_risk, deforestation_risk=defor_risk,
        bare_regions=bare_regions, burn_regions=burn_regions,
    )

def cv_detect_roads(img_bgr):
    H, W = img_bgr.shape[:2]
    
    blurred = cv2.GaussianBlur(img_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    
    bare_mask = cv2.inRange(hsv, np.array([5, 10, 40]), np.array([35, 220, 255]))
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
    
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=60, minLineLength=min_len, maxLineGap=int(min_len * 0.15))
    
    if lines is None:
        return {"road_segments":[], "road_count": 0, "road_coverage_pct": 0.0}
        
    segments =[]
    road_pixel_mask = np.zeros((H, W), dtype=np.uint8)
    
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        if length < min_len: continue
            
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if angle < 5 or angle > 175 or (85 < angle < 95): continue
            
        length_pct = round(length / np.sqrt(H**2 + W**2) * 100, 2)
        confidence = int(min(99, max(50, 60 + (length_pct * 1.5))))
        
        segments.append({
            "x1": round(x1 / W, 4), "y1": round(y1 / H, 4),
            "x2": round(x2 / W, 4), "y2": round(y2 / H, 4),
            "length_pct": length_pct, "confidence": confidence
        })
        cv2.line(road_pixel_mask, (x1, y1), (x2, y2), 255, thickness=6)
        
    road_coverage = round(cv2.countNonZero(road_pixel_mask) / (H * W) * 100, 2)
    segments.sort(key=lambda s: s["length_pct"], reverse=True)
    
    return {"road_segments": segments[:15], "road_count": len(segments), "road_coverage_pct": road_coverage}

def cv_change_detect(img_a, img_b):
    h = min(img_a.shape[0], img_b.shape[0])
    w = min(img_a.shape[1], img_b.shape[1])
    
    a = cv2.resize(img_a, (w, h))
    b = cv2.resize(img_b, (w, h))
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
        veg_before=round(va, 1), veg_after=round(vb, 1), veg_delta=round(vb - va, 1),
        bare_before=round(ba, 1), bare_after=round(bb, 1), bare_delta=round(bb - ba, 1),
        change_regions=n_regions, change_boxes=change_regions_raw, 
        new_bare_regions=new_bare_regions,
    )

# ==============================================================================
# FLASK ROUTES
# ==============================================================================

@app.route('/')
@app.route('/index.html')
def index(): 
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/dashboard.html')
def dashboard(): 
    return send_from_directory(FRONTEND_DIR, 'dashboard.html')

@app.route('/control.html')
def control(): 
    return send_from_directory(FRONTEND_DIR, 'control.html')

@app.route('/<path:filename>')
def serve_static(filename): 
    return send_from_directory(FRONTEND_DIR, filename)

@app.route('/api/samples')
def list_samples():
    if not os.path.exists(SAMPLES_DIR): 
        return jsonify([])
    valid_files =[f for f in os.listdir(SAMPLES_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    return jsonify(sorted(valid_files))

@app.route('/samples/<path:filename>')
def serve_sample(filename): 
    return send_from_directory(SAMPLES_DIR, filename)

@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    req_data = request.get_json()
    filename = req_data.get('filename', '')
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
    req_data = request.get_json()
    pa = os.path.join(SAMPLES_DIR, os.path.basename(req_data.get('before', '')))
    pb = os.path.join(SAMPLES_DIR, os.path.basename(req_data.get('after', '')))
    
    ia = cv2.imread(pa)
    ib = cv2.imread(pb)
    
    if ia is None or ib is None: 
        return jsonify({"error": "Could not read images"}), 500
        
    result = cv_change_detect(ia, ib)
    result["before"] = req_data.get('before', '')
    result["after"] = req_data.get('after', '')
    return jsonify(result)

@app.route('/api/predict_pass', methods=['GET'])
def predict_pass():
    """Uses Skyfield to calculate the precise UNIX timestamp of the next pass over the target."""
    t0 = ts.now()
    t1 = ts.tt_jd(t0.tt + 1.0) 
    
    t, events = satellite.find_events(TARGET_LOCATION, t0, t1, altitude_degrees=10.0)
    
    for ti, event in zip(t, events):
        if event == 1: 
            unix_time = int(ti.utc_datetime().timestamp())
            date_str = ti.utc_datetime().strftime('%Y-%m-%d %H:%M:%S UTC')
            return jsonify({
                "unix": unix_time,
                "date": date_str,
                "target_lat": TARGET_LAT,
                "target_lng": TARGET_LNG
            })
            
    return jsonify({"error": "No pass found in the next 24 hours"}), 404

def get_satellite_pos():
    geo = satellite.at(ts.now())
    sub = geo.subpoint()
    return sub.latitude.degrees, sub.longitude.degrees

# ==============================================================================
# WEBSOCKET COMMAND UPLINK 
# ==============================================================================
@socketio.on('send_command')
def handle_command(data):
    cmd = data.get('cmd')
    if ser and ser.is_open:
        try:
            full_cmd = f"{cmd}\n"
            ser.write(full_cmd.encode('utf-8'))
            print(f"⬆️ UPLINK COMMAND SENT: {cmd}")
            socketio.emit('terminal_log', {"msg": f"> {cmd}", "type": "tx"})
        except Exception as e:
            socketio.emit('terminal_log', {"msg": f"ERROR: {e}", "type": "error"})
    else:
        socketio.emit('terminal_log', {"msg": "ERROR: Serial Port Not Open", "type": "error"})

# ==============================================================================
# SERIAL THREAD (Data Downlink)
# ==============================================================================
def read_serial_data():
    global ser
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n📡 Connected to Ground Station ESP32 Simulator on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                # Intercept the CSV stream
                if line.startswith("TLM_RCV,"):
                    try:
                        parts = line.split(',')
                        
                        # We need at least 22 parts now that IMU is removed
                        if len(parts) >= 22: 
                            gs_rssi = int(parts[1])
                            
                            data = {
                                "type": "TELEMETRY",
                                "rssi_gs": gs_rssi,
                                "timestamp": int(parts[3]),
                                "fdir_mode": parts[4],
                                "payload_state": int(parts[5]),
                                "obc_temp": float(parts[6]),
                                "payload_temp": float(parts[7]),
                                "rssi_uplink": int(parts[8]),
                                "eps": {
                                    "soc": float(parts[9]),
                                    "v_bat": float(parts[10]),
                                    "v_3v3": float(parts[11]),
                                    "v_5v": float(parts[12]),
                                    "i_in": int(parts[13]),
                                    "i_out": int(parts[14]),
                                    "i_payload": int(parts[15]),
                                    "i_comms": int(parts[16]),
                                    "temp": float(parts[17])
                                },
                                "env": {
                                    "pressure": float(parts[18]),
                                    "humidity": float(parts[19])
                                },
                                "gps": {
                                    "alt": float(parts[20])
                                }
                            }
                            
                            idx = 21
                            has_gsn = int(parts[idx])
                            idx += 1
                            
                            if has_gsn == 1 and len(parts) >= idx + 10:
                                data["gsn"] = {
                                    "timestamp": int(parts[idx]),
                                    "node_id": parts[idx+1],
                                    "rssi": int(parts[idx+2]),
                                    "temp": float(parts[idx+3]),
                                    "hum": float(parts[idx+4]),
                                    "soil": int(parts[idx+5]),
                                    "smoke": int(parts[idx+6]),
                                    "sound": int(parts[idx+7]),
                                    "v_bat": float(parts[idx+8]),
                                    "soc": int(parts[idx+9])
                                }
                                idx += 10
                                
                            if len(parts) >= idx + 64:
                                data["thermal"] =[float(p) for p in parts[idx:idx+64]]
                                
                            lat, lng = get_satellite_pos()
                            data["lat"] = lat
                            data["lng"] = lng
                            
                            socketio.emit('telemetry_update', data)
                            
                    except Exception as parse_error: 
                        print(f"Failed to parse CSV string: {parse_error}")
                
                elif len(line) > 0:
                    socketio.emit('terminal_log', {"msg": line, "type": "rx"})
            
            socketio.sleep(0.01)
            
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}")

if __name__ == '__main__':
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)