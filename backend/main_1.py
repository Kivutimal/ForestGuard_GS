import serial
import json
import os
import cv2
import numpy as np
import random
import datetime
import math
import sqlite3
from werkzeug.security import check_password_hash 
from flask import Flask, send_from_directory, request, jsonify, session, redirect, render_template 
from flask_socketio import SocketIO
from skyfield.api import load, EarthSatellite, wgs84
from functools import wraps

# ==============================================================================
# CONFIGURATION
# ==============================================================================
SERIAL_PORT = 'COM11'
BAUD_RATE = 115200

line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'
ts = load.timescale()
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', ts)

TARGET_LAT = -0.2325
TARGET_LNG = 35.5523
TARGET_LOCATION = wgs84.latlon(TARGET_LAT, TARGET_LNG)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))
SAMPLES_DIR = os.path.join(BASE_DIR, "samples")

app = Flask(__name__, template_folder=FRONTEND_DIR) # <-- Tell Flask where your HTML is
app.secret_key = 'forestguard_super_secret_aerospace_key_2026' # <-- NEW: Required for sessions!
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
ser = None

# ==============================================================================
# OPENCV HELPERS & GEO-REFERENCING
# ==============================================================================
def get_regions(mask, img_shape, min_area_frac=0.005, label='', max_regions=8, center_lat=None, center_lng=None):
    H, W = img_shape[:2]
    total = H * W
    kernel = np.ones((9, 9), np.uint8)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    
    for c in contours:
        area = cv2.contourArea(c)
        if area < total * min_area_frac: continue
        x, y, w, h = cv2.boundingRect(c)
        
        x_pct = round(x / W, 4)
        y_pct = round(y / H, 4)
        w_pct = round(w / W, 4)
        h_pct = round(h / H, 4)
        
        extent = area / float(w * h) if (w * h) > 0 else 0
        area_pct = round(area / total * 100, 2)
        confidence = int(min(99, max(45, (extent * 80) + (area_pct * 1.5))))
        
        region_data = {
            "x": x_pct, "y": y_pct, "w": w_pct, "h": h_pct, 
            "area_pct": area_pct, "label": label, "confidence": confidence
        }
        
        # --- NEW: PIXEL TO REAL-WORLD COORDINATE MATH ---
        if center_lat is not None and center_lng is not None:
            # Assume the image covers exactly a 5km x 5km square on Earth
            image_width_meters = 5000.0 
            
            # Find the center of this specific bounding box
            cx_pct = x_pct + (w_pct / 2.0)
            cy_pct = y_pct + (h_pct / 2.0)
            
            # Distance from the exact center of the image (0.5, 0.5)
            dx_pct = cx_pct - 0.5
            dy_pct = 0.5 - cy_pct # Invert Y: smaller Y means North
            
            dx_meters = dx_pct * image_width_meters
            dy_meters = dy_pct * image_width_meters
            
            # 1 degree of Latitude ~ 111,139 meters. Longitude changes based on Lat.
            d_lat = dy_meters / 111139.0
            d_lng = dx_meters / (111139.0 * math.cos(math.radians(center_lat)))
            
            region_data["lat"] = round(center_lat + d_lat, 5)
            region_data["lng"] = round(center_lng + d_lng, 5)
            
        regions.append(region_data)
        
    regions.sort(key=lambda r: r["area_pct"], reverse=True)
    return regions[:max_regions]

def cv_analyze_rgb(img_bgr, center_lat=None, center_lng=None):
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
    
    health = max(0, min(100, round(veg_pct * 0.55 + max(0, (mean_ndvi + 0.2) / 1.2 * 100) * 0.30 + max(0, 100 - bare_pct * 2 - burn_pct * 4) * 0.15, 1)))
    grade = 'A' if health >= 80 else 'B' if health >= 65 else 'C' if health >= 50 else 'D' if health >= 35 else 'F'
    fire_risk = 'critical' if burn_pct > 12 else 'high' if burn_pct > 5 else 'medium' if burn_pct > 2 else 'low'
    defor_risk = 'critical' if bare_pct > 40 or edge_density > 18 else 'high' if bare_pct > 20 or edge_density > 12 else 'medium' if bare_pct > 8 else 'low'
        
    return dict(
        vegetation_pct=veg_pct, bare_pct=bare_pct, burn_pct=burn_pct, 
        ndvi_proxy=mean_ndvi, edge_density=edge_density, 
        health_score=health, health_grade=grade, 
        fire_risk=fire_risk, deforestation_risk=defor_risk, 
        bare_regions=get_regions(bare_mask, img_bgr.shape, label='Cleared/Deforested', center_lat=center_lat, center_lng=center_lng), 
        burn_regions=get_regions(burn_mask, img_bgr.shape, label='Burn Scar', center_lat=center_lat, center_lng=center_lng)
    )

def cv_detect_roads(img_bgr):
    H, W = img_bgr.shape[:2]
    blurred = cv2.GaussianBlur(img_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    bare_mask = cv2.inRange(hsv, np.array([5, 10, 40]), np.array([35, 220, 255]))
    bare_mask_dilated = cv2.dilate(bare_mask, np.ones((15, 15), np.uint8), iterations=2)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY))
    k_h, k_v = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1)), cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
    tophat = cv2.bitwise_and(cv2.add(cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_h), cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_v)), bare_mask_dilated)
    edges = cv2.dilate(cv2.Canny(tophat, 50, 150), np.ones((2, 2), np.uint8))
    min_len = int(min(H, W) * 0.10)
    lines = cv2.HoughLinesP(edges, rho=1, theta=np.pi / 180, threshold=60, minLineLength=min_len, maxLineGap=int(min_len * 0.15))
    if lines is None: return {"road_segments":[], "road_count": 0, "road_coverage_pct": 0.0}
        
    segments, road_pixel_mask =[], np.zeros((H, W), dtype=np.uint8)
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        if length < min_len: continue
        angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if angle < 5 or angle > 175 or (85 < angle < 95): continue
        length_pct = round(length / np.sqrt(H**2 + W**2) * 100, 2)
        segments.append({"x1": round(x1/W, 4), "y1": round(y1/H, 4), "x2": round(x2/W, 4), "y2": round(y2/H, 4), "length_pct": length_pct, "confidence": int(min(99, max(50, 60 + (length_pct * 1.5))))})
        cv2.line(road_pixel_mask, (x1, y1), (x2, y2), 255, thickness=6)
        
    segments.sort(key=lambda s: s["length_pct"], reverse=True)
    return {"road_segments": segments[:15], "road_count": len(segments), "road_coverage_pct": round(cv2.countNonZero(road_pixel_mask) / (H * W) * 100, 2)}

def cv_change_detect(img_a, img_b):
    h, w = min(img_a.shape[0], img_b.shape[0]), min(img_a.shape[1], img_b.shape[1])
    a, b, total = cv2.resize(img_a, (w, h)), cv2.resize(img_b, (w, h)), h * w
    diff = cv2.absdiff(a, b)
    _, thresh = cv2.threshold(cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY), 28, 255, cv2.THRESH_BINARY)
    
    def veg_pct(img): return cv2.countNonZero(cv2.inRange(cv2.cvtColor(img, cv2.COLOR_BGR2HSV), np.array([35,40,40]), np.array([85,255,255]))) / total * 100
    def bare_pct(img): return cv2.countNonZero(cv2.inRange(cv2.cvtColor(img, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))) / total * 100
    va, vb, ba, bb = veg_pct(a), veg_pct(b), bare_pct(a), bare_pct(b)
    
    bare_after, bare_before = cv2.inRange(cv2.cvtColor(b, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210])), cv2.inRange(cv2.cvtColor(a, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))
    new_bare = cv2.bitwise_and(bare_after, cv2.bitwise_not(bare_before))
    
    contours, _ = cv2.findContours(cv2.dilate(thresh, np.ones((7,7), np.uint8), iterations=2), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return dict(change_pct=round(cv2.countNonZero(thresh) / total * 100, 1), veg_before=round(va, 1), veg_after=round(vb, 1), veg_delta=round(vb - va, 1), bare_before=round(ba, 1), bare_after=round(bb, 1), bare_delta=round(bb - ba, 1), change_regions=len([c for c in contours if cv2.contourArea(c) > total * 0.005]), change_boxes=get_regions(thresh, (h, w), label='Changed area'), new_bare_regions=get_regions(new_bare, (h, w), label='Newly cleared'))

# ==============================================================================
# FLASK ROUTES & SECURITY
# ==============================================================================
def login_required(role_required=None):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # 1. Check if they have an active session (cookie)
            if 'username' not in session:
                return redirect('/login')
            
            # 2. Check if they have the right clearance level
            user_role = session.get('role')
            if role_required == 'commander' and user_role != 'commander':
                # ---> NEW: Send them to the Access Denied page! <---
                return redirect('/unauthorized.html')
                
            return f(*args, **kwargs)
        return decorated_function
    return decorator

@app.route('/')
@app.route('/index.html')
def index(): 
    # Public route - anyone can see the tracker!
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/dashboard.html')
@login_required() # <-- LOCKED: Requires any valid login
def dashboard(): 
    return send_from_directory(FRONTEND_DIR, 'dashboard.html')

@app.route('/control.html')
@login_required(role_required='commander') # <-- STRICT LOCK: Requires Admin!
def control(): 
    return send_from_directory(FRONTEND_DIR, 'control.html')

@app.route('/<path:filename>')
def serve_static(filename): return send_from_directory(FRONTEND_DIR, filename)

@app.route('/api/samples')
def list_samples(): return jsonify(sorted([f for f in os.listdir(SAMPLES_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))])) if os.path.exists(SAMPLES_DIR) else jsonify([])
@app.route('/samples/<path:filename>')
def serve_sample(filename): return send_from_directory(SAMPLES_DIR, filename)

@app.route('/api/analyze', methods=['POST'])
# ==============================================================================
# FLASK ROUTES & SECURITY
# ==============================================================================

@app.route('/login', methods=['GET', 'POST'])
def login():
    # --- NEW FIX: Check if they are ALREADY logged in! ---
    if 'username' in session:
        # If they already have an ID card, bypass the login screen entirely
        if session.get('role') == 'commander':
            return redirect('/control.html')
        else:
            return redirect('/dashboard.html')
    # -----------------------------------------------------

    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        db_path = os.path.join(BASE_DIR, 'forestguard.db')
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT password_hash, role FROM users WHERE username=?", (username,))
            user = cursor.fetchone()
            conn.close()

            if user and check_password_hash(user[0], password):
                session['username'] = username
                session['role'] = user[1]
                
                if user[1] == 'commander':
                    return redirect('/control.html')
                else:
                    return redirect('/dashboard.html')
            else:
                error = "Invalid Operator ID or Passcode."
        else:
            error = "Database offline. Run init_db.py first."

    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.clear() # Destroys the cookie
    return redirect('/')

def analyze_image():
    req_data = request.get_json()
    filename = req_data.get('filename', '')
    
    # 1. FIND THE IMAGE TIME (Hybrid Logic)
    time_str = None
    if filename.startswith("IMG_"):
        # Real payload image format: IMG_20260531_143000.jpg
        time_str = filename.replace("IMG_", "").replace(".jpg", "")
    else:
        # Downloaded sample format: check catalog.json
        catalog_path = os.path.join(SAMPLES_DIR, 'catalog.json')
        if os.path.exists(catalog_path):
            with open(catalog_path, 'r') as f:
                catalog = json.load(f)
                if filename in catalog:
                    time_str = catalog[filename]

    # 2. GET IMAGE CENTER COORDINATE FROM SKYFIELD
    center_lat, center_lng = None, None
    if time_str:
        try:
            dt = datetime.datetime.strptime(time_str, "%Y%m%d_%H%M%S")
            dt = dt.replace(tzinfo=datetime.timezone.utc)
            t = ts.from_datetime(dt)
            subpoint = satellite.at(t).subpoint()
            center_lat = round(subpoint.latitude.degrees, 4)
            center_lng = round(subpoint.longitude.degrees, 4)
        except Exception as e:
            print(f"Geolocation error: {e}")

    # 3. RUN OPENCV ANALYSIS (Pass the center coords to generate AOIs)
    img = cv2.imread(os.path.join(SAMPLES_DIR, os.path.basename(filename)))
    if img is None: 
        return jsonify({"error": "Could not decode image"}), 500
        
    res = cv_analyze_rgb(img, center_lat=center_lat, center_lng=center_lng)
    res.update(cv_detect_roads(img))
    res["filename"] = filename
    
    if center_lat and center_lng:
        res["image_center_lat"] = center_lat
        res["image_center_lng"] = center_lng
        res["capture_time"] = time_str
        
    return jsonify(res)

@app.route('/api/compare', methods=['POST'])
def compare_images():
    req_data = request.get_json()
    ia, ib = cv2.imread(os.path.join(SAMPLES_DIR, os.path.basename(req_data.get('before', '')))), cv2.imread(os.path.join(SAMPLES_DIR, os.path.basename(req_data.get('after', ''))))
    if ia is None or ib is None: return jsonify({"error": "Could not read images"}), 500
    res = cv_change_detect(ia, ib); res["before"] = req_data.get('before', ''); res["after"] = req_data.get('after', '')
    return jsonify(res)

@app.route('/api/predict_pass', methods=['GET'])
def predict_pass():
    # --- NEW: Retrieve lat/lng from URL, default to Mau Forest if missing ---
    lat_str = request.args.get('lat', '-0.2325')
    lng_str = request.args.get('lng', '35.5523')
    
    try:
        target_lat = float(lat_str)
        target_lng = float(lng_str)
    except ValueError:
        return jsonify({"error": "Invalid coordinates provided"}), 400
        
    # Generate the dynamic Skyfield target location
    dynamic_target = wgs84.latlon(target_lat, target_lng)
    
    t0 = ts.now()
    t1 = ts.tt_jd(t0.tt + 1.0) # Search window: Next 24 hours
    
    # Calculate flyovers for the specific coordinates
    t, events = satellite.find_events(dynamic_target, t0, t1, altitude_degrees=10.0)
    
    for ti, event in zip(t, events):
        # Event 1 represents the culmination (Peak highest altitude of the pass)
        # This is exactly when the camera should fire for the clearest image!
        if event == 1: 
            return jsonify({
                "unix": int(ti.utc_datetime().timestamp()), 
                "date": ti.utc_datetime().strftime('%Y-%m-%d %H:%M:%S UTC'), 
                "target_lat": target_lat, 
                "target_lng": target_lng
            })
            
    return jsonify({"error": "No pass found for these coordinates in the next 24 hours"}), 404

# ==============================================================================
# HISTORICAL DATA API (Fetching from SQLite for Charts & UI Hydration)
# ==============================================================================
@app.route('/api/history/<subsystem>', methods=['GET'])
@login_required()
def get_historical_data(subsystem):
    """Fetches historical data from the database for the charts and UI hydration."""
    
    limit = request.args.get('limit', 100, type=int)
    start_time = request.args.get('start')
    end_time = request.args.get('end')
    
    db_path = os.path.join(BASE_DIR, 'forestguard.db')
    data = []
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row # Access columns by name
        cursor = conn.cursor()
        
        # --- Build the dynamic time-aware query ---
        query = f"SELECT * FROM {subsystem} "
        params = []
        
        if start_time and end_time:
            query += "WHERE timestamp >= ? AND timestamp <= ? "
            params.extend([start_time, end_time])
            
        query += "ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        # Execute the query ONCE!
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        # Map the results based on which table we queried
        if subsystem == 'telemetry':
            for r in rows:
                data.append({
                    "timestamp": r["timestamp"],
                    "rssi_gs": r["gs_rssi"],
                    "rssi_uplink": r["rssi_uplink"],
                    "obc_temp": r["obc_temp"],
                    "payload_temp": r["payload_temp"],
                    "eps_temp": r["eps_temp"],
                    "eps_soc": r["eps_soc"],
                    "eps_v_bat": r["eps_v_bat"],
                    "eps_v_3v3": r["eps_v_3v3"],
                    "eps_v_5v_1": r["eps_v_5v_1"],
                    "eps_v_5v_2": r["eps_v_5v_2"],
                    "eps_v_5v_3": r["eps_v_5v_3"],
                    "eps_i_in": r["eps_i_in"],
                    "eps_i_out": r["eps_i_out"],
                    "eps_i_payload": r["eps_i_payload"],
                    "eps_i_comms": r["eps_i_comms"],
                    "env_pressure": r["env_pressure"],
                    "env_humidity": r["env_humidity"],
                    "gps_alt": r["gps_alt"],
                    "obc_sd": r["obc_sd"],
                    "payload_sd": r["payload_sd"]
                })
                
        elif subsystem == 'gsn':
            for r in rows:
                data.append({
                    "timestamp": r["timestamp"],
                    "node_id": r["node_id"],
                    "temp": r["temp"],
                    "hum": r["hum"],
                    "soil": r["soil"],
                    "smoke": r["smoke"],   
                    "sound": r["sound"],   
                    "v_bat": r["v_bat"],
                    "soc": r["soc"],
                    "sd": r["sd_used"],
                    "rssi": r["rssi"]  # <-- Maps the GSN Node RSSI!
                })
                
        conn.close()
        
        # Reverse the data so it reads oldest-to-newest for the charts
        data.reverse()
        return jsonify(data)
        
    except Exception as e:
        print(f"API History Error: {e}")
        return jsonify({"error": str(e)}), 500
    
def get_satellite_pos():
    sub = satellite.at(ts.now()).subpoint()
    return sub.latitude.degrees, sub.longitude.degrees

# ==============================================================================
# WEBSOCKET COMMAND UPLINK & AUDIT LOG
# ==============================================================================
@socketio.on('send_command')
def handle_command(data):
    cmd = data.get('cmd')
    
    # 1. Grab the username of the operator who clicked the button
    operator = session.get('username', 'system') 
    
    # 2. Log this action to the Database Audit Trail
    db_path = os.path.join(BASE_DIR, 'forestguard.db')
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO command_log (username, command_text) VALUES (?, ?)", (operator, cmd))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Audit Log Error: {e}")

    # 3. Transmit the command to the satellite via LoRa (Serial)
    if ser and ser.is_open:
        try:
            full_cmd = f"{cmd}\n"
            ser.write(full_cmd.encode('utf-8'))
            socketio.emit('terminal_log', {"msg": f"> {cmd} (Operator: {operator})", "type": "tx"})
        except Exception as e:
            socketio.emit('terminal_log', {"msg": f"ERROR: {e}", "type": "error"})
    else:
        # Show it in the UI terminal even if the hardware isn't plugged in yet!
        socketio.emit('terminal_log', {"msg": f"> {cmd} (Operator: {operator}) [NO HARDWARE]", "type": "tx"})
# ==============================================================================
# ALARM & EVENT LOGGING ARCHITECTURE
# ==============================================================================
@app.route('/api/active_alarms', methods=['GET'])
@login_required()
def get_active_alarms():
    """Fetches all un-acknowledged alarms so they survive a page refresh!"""
    db_path = os.path.join(BASE_DIR, 'forestguard.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Fetch alarms where acknowledged is 0 (False)
    cursor.execute("SELECT id, timestamp, source, message, level FROM alarms WHERE acknowledged = 0 ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    
    alarms = [{"id": r[0], "timestamp": r[1], "source": r[2], "message": r[3], "level": r[4]} for r in rows]
    return jsonify(alarms)

@socketio.on('trigger_alarm')
def handle_trigger_alarm(data):
    """Saves a newly detected alarm to the database."""
    db_path = os.path.join(BASE_DIR, 'forestguard.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Prevent spam: Only insert if this exact un-acknowledged alarm doesn't already exist
    cursor.execute("SELECT id FROM alarms WHERE source=? AND message=? AND acknowledged=0", (data['source'], data['message']))
    if cursor.fetchone() is None:
        cursor.execute("INSERT INTO alarms (timestamp, source, message, level) VALUES (?, ?, ?, ?)",
                       (data['timestamp'], data['source'], data['message'], data['level']))
        conn.commit()
        alarm_id = cursor.lastrowid
        
        # Broadcast the new alarm back to ALL connected operators so it pops up on their screens
        data['id'] = alarm_id
        socketio.emit('new_alarm_broadcast', data)
        
    conn.close()

@socketio.on('acknowledge_alarm')
def handle_ack_alarm(data):
    """Marks an alarm as acknowledged in the DB and removes it from screens."""
    alarm_id = data.get('id')
    operator = session.get('username', 'system')
    
    db_path = os.path.join(BASE_DIR, 'forestguard.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Update the database to show WHO acknowledged it and WHEN
    cursor.execute("UPDATE alarms SET acknowledged = 1, ack_by = ?, ack_time = CURRENT_TIMESTAMP WHERE id = ?", (operator, alarm_id))
    conn.commit()
    conn.close()
    
    # Tell all connected browsers to remove this alarm from their screens
    socketio.emit('remove_alarm_broadcast', {"id": alarm_id, "operator": operator})
    socketio.emit('terminal_log', {"msg": f"✅ Alarm #{alarm_id} acknowledged by {operator}", "type": "rx"})
# ==============================================================================
# SERIAL THREAD (Data Downlink & Routing)
# ==============================================================================
def read_serial_data():
    global ser
    
    now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    tlm_filepath = os.path.join(BASE_DIR, f"TLM_{now_str}.csv")
    gsn_filepath = os.path.join(BASE_DIR, f"GSN_{now_str}.csv")
    
    with open(tlm_filepath, 'a') as f:
        f.write("PACKET_TYPE,GS_RSSI,SAT_ID,TIMESTAMP,FDIR_MODE,PAYLOAD_STATE,OBC_T,PAYLOAD_T,SAT_RX_RSSI,SOC,V_BAT,V_3V3,V_5V_1,V_5V_2,V_5V_3,I_IN,I_OUT,I_PAY,I_COMMS,EPS_T,PRESSURE,HUMIDITY,GPS_ALT,OBC_SD_PCT,PAYLOAD_SD_PCT,RESOLUTION,IR_0,IR_1,IR_2,IR_3,IR_4\n")

    with open(gsn_filepath, 'a') as f:
        f.write("PACKET_TYPE,TIMESTAMP,NODE_ID,RSSI,TEMP,HUMIDITY,SOIL,SMOKE,SOUND,V_BAT,SOC,SD_PCT\n")

    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n📡 Ground Station Active on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                # --- ROUTE 1: THE LIVE BEACON (Heartbeat) ---
                if line.startswith("BCN_RCV,"):
                    # SIMULATING LOCAL HARDWARE: Measure Downlink RSSI right when packet arrives
                    local_downlink_rssi = random.randint(-95, -40) 
                    
                    try:
                        parts = line.split(',')
                        if len(parts) >= 11:
                            data = {
                                "type": "LIVE_BEACON",
                                "rssi_gs": local_downlink_rssi,
                                "timestamp": parts[2],
                                "fdir_mode": parts[3],
                                "payload_state": int(parts[4]),
                                "obc_temp": float(parts[5]),
                                "eps": {
                                    "soc": float(parts[6]),
                                    "v_bat": float(parts[7]),
                                    "v_3v3": float(parts[8])
                                },
                                "env": {"pressure": float(parts[9])},
                                "gps": {"alt": float(parts[10])}
                            }
                            # Get Live Map Position
                            lat, lng = get_satellite_pos()
                            data["lat"], data["lng"] = lat, lng
                            
                            socketio.emit('telemetry_update', data)
                    except Exception as e:
                        print(f"Beacon Parse error: {e}")

                # --- ROUTE 2: HISTORICAL TELEMETRY (SD Card Dump) ---
                elif line.startswith("TLM_RCV,"):
                    # 1. Save to CSV Cold Backup (Exactly as it arrived from space)
                    with open(tlm_filepath, 'a') as f:
                        f.write(line + "\n")

                    try:
                        parts = line.split(',')
                        if len(parts) >= 24: 
                            # Helper to safely parse blanks into NULLs
                            def parse_int(val): return int(val) if val.strip() != "" else None
                            
                            data = {
                                "type": "HISTORICAL_TELEMETRY", 
                                "rssi_gs": None, # <-- Physically accurate! We don't record local RSSI in history.
                                "timestamp": parts[2], 
                                "fdir_mode": parts[3], 
                                "payload_state": int(parts[4]), 
                                "obc_temp": float(parts[5]),
                                "payload_temp": float(parts[6]), 
                                "rssi_uplink": parse_int(parts[7]), # <-- Safely handles blanks
                                "eps": {"soc": float(parts[8]), "v_bat": float(parts[9]), "v_3v3": float(parts[10]), "v_5v_1": float(parts[11]), "v_5v_2": float(parts[12]), "v_5v_3": float(parts[13]),"i_in": int(parts[14]), "i_out": int(parts[15]), "i_payload": int(parts[16]), "i_comms": int(parts[17]), "temp": float(parts[18])},
                                "env": {"pressure": float(parts[19]), "humidity": float(parts[20])},
                                "gps": {"alt": float(parts[21])},
                                "sd": {"obc": float(parts[22]), "payload": float(parts[23])},
                                "resolution": int(parts[24]) 
                            }
                            
                            idx = 25 
                            if len(parts) >= idx + 5:
                                data["ir_zones"] = [int(parts[idx]), int(parts[idx+1]), int(parts[idx+2]), int(parts[idx+3]), int(parts[idx+4])]
                            
                            # 2. SAVE TO SQLITE DATABASE
                            db_path = os.path.join(BASE_DIR, 'forestguard.db')
                            conn = sqlite3.connect(db_path)
                            cursor = conn.cursor()
                            cursor.execute('''
                                INSERT INTO telemetry (
                                    timestamp, gs_rssi, fdir_mode, payload_state, obc_temp, payload_temp, rssi_uplink,
                                    eps_soc, eps_v_bat, eps_v_3v3, eps_v_5v_1, eps_v_5v_2, eps_v_5v_3,
                                    eps_i_in, eps_i_out, eps_i_payload, eps_i_comms, eps_temp,
                                    env_pressure, env_humidity, gps_alt, obc_sd, payload_sd, image_res,
                                    ir_0, ir_1, ir_2, ir_3, ir_4
                                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                            ''', (
                                data["timestamp"], data["rssi_gs"], data["fdir_mode"], data["payload_state"],
                                data["obc_temp"], data["payload_temp"], data["rssi_uplink"],
                                data["eps"]["soc"], data["eps"]["v_bat"], data["eps"]["v_3v3"],
                                data["eps"]["v_5v_1"], data["eps"]["v_5v_2"], data["eps"]["v_5v_3"],
                                data["eps"]["i_in"], data["eps"]["i_out"], data["eps"]["i_payload"],
                                data["eps"]["i_comms"], data["eps"]["temp"],
                                data["env"]["pressure"], data["env"]["humidity"], data["gps"]["alt"],
                                data["sd"]["obc"], data["sd"]["payload"], data["resolution"],
                                data.get("ir_zones", [0,0,0,0,0])[0], data.get("ir_zones", [0,0,0,0,0])[1], 
                                data.get("ir_zones", [0,0,0,0,0])[2], data.get("ir_zones", [0,0,0,0,0])[3], 
                                data.get("ir_zones", [0,0,0,0,0])[4]
                            ))
                            conn.commit()
                            conn.close()

                            socketio.emit('telemetry_update', data)
                    except Exception as e: 
                        print(f"TLM Parse error: {e}")
                
                # --- ROUTE 2: GSN HISTORICAL DATA REQUEST ---
                elif line.startswith("GSN_RCV,"):
                    with open(gsn_filepath, 'a') as f:
                        f.write(line + "\n")
                    
                    try:
                        parts = line.split(',')
                        if len(parts) >= 12:
                            def parse_int(val): return int(val) if val.strip() != "" else None
                            
                            gsn_data = {
                                "type": "GSN_UPDATE",
                                "gsn": {
                                    "timestamp": parts[1],
                                    "node_id": parts[2],
                                    "rssi": parse_int(parts[3]), # <-- Safely handles blanks
                                    "temp": float(parts[4]),
                                    "hum": float(parts[5]),
                                    "soil": int(parts[6]),
                                    "smoke": int(parts[7]),
                                    "sound": int(parts[8]),
                                    "v_bat": float(parts[9]),
                                    "soc": int(parts[10]),
                                    "sd": float(parts[11])
                                }
                            }
                            
                            # 2. SAVE TO SQLITE DATABASE
                            db_path = os.path.join(BASE_DIR, 'forestguard.db')
                            conn = sqlite3.connect(db_path)
                            cursor = conn.cursor()
                            cursor.execute('''
                                INSERT INTO gsn (
                                    timestamp, node_id, rssi, temp, hum, soil, smoke, sound, v_bat, soc, sd_used
                                ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                            ''', (
                                gsn_data["gsn"]["timestamp"], gsn_data["gsn"]["node_id"], gsn_data["gsn"]["rssi"],
                                gsn_data["gsn"]["temp"], gsn_data["gsn"]["hum"], gsn_data["gsn"]["soil"],
                                gsn_data["gsn"]["smoke"], gsn_data["gsn"]["sound"], gsn_data["gsn"]["v_bat"],
                                gsn_data["gsn"]["soc"], gsn_data["gsn"]["sd"]
                            ))
                            conn.commit()
                            conn.close()

                            # 3. Send to UI (UI will debounce and update the boxes)
                            socketio.emit('telemetry_update', gsn_data)
                    except Exception as e:
                        print(f"GSN Parse/DB error: {e}")


                # --- ROUTE 3: IMAGE CATALOG REQUEST ---
                elif line.startswith("IMG_LIST:"):
                    files = line.split(":", 1)[1]
                    socketio.emit('terminal_log', {"msg": f"📸 PAYLOAD CATALOG: {files}", "type": "rx"})

                # --- ROUTE 4: STANDARD OBC ACKNOWLEDGMENTS ---
                elif line.startswith("TLM_MSG,"):
                    msg = line.split("TLM_MSG,")[1]
                    socketio.emit('terminal_log', {"msg": f"OBC ACK: {msg}", "type": "rx"})
                    
            socketio.sleep(0.01)
    except Exception as e: 
        print(f"\n❌ SERIAL ERROR: {e}")

if __name__ == '__main__':
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)