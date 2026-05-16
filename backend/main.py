#====================
#IMPORTS - Libraries
#====================
import serial #lets python communicate with hardware via serial
import json #For reading and writing JSON data
import os #Interaction with the OS e.g. for finding paths
import cv2 #Computer vision library
import numpy as np #Numerical data and arrays especially for OpenCV
import random #Generates random numbers for simulation
#=======================================================================================
#Flask for the server, serve files from specific folders, converting python dictionaries
#JSON for JS, and real time two way comms between your server and UI
#========================================================================================
from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO

#Skyfield calculates exact coordinates for orbits - (Rocket-science math library)
from skyfield.api import load, EarthSatellite

# ==============================================================================
# CONFIGURATION- Hardware settings
# ==============================================================================
SERIAL_PORT = 'COM11'
BAUD_RATE = 115200

# Orbital settings: The TLE (Two-Line Element) math formula defines the orbit
line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'

#Create the live mathematical model of the satellite using the TLE data above
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', load.timescale())

#Folder Paths: Creating dynamic maps to determine where files are
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) #The exact folder for the main.py file
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public")) #HTML and CSS files
SAMPLES_DIR = os.path.join(BASE_DIR, "samples") #samples for OpenCV analysis

#Server Setup: Turns on the web server and the real time two-way communication (SocketIO)
app = Flask(__name__)
#cors_allowed_origins="*" acts as a VIP pass so the browser doesn't block the live data
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ==============================================================================
# OPENCV HELPERS
# ==============================================================================

def get_regions(mask, img_shape, min_area_frac=0.005, label='', max_regions=8):
    """
    Finds bounding boxes for specific masked features (e.g., burn scars, bare earth)
    and calculates a confidence score based on area and extent.
    """
    H, W = img_shape[:2]
    total = H * W
    kernel = np.ones((9, 9), np.uint8)
    
    # Clean up the mask using morphological operations
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    regions =[]
    
    for c in contours:
        area = cv2.contourArea(c)
        
        # Ignore regions that are too small
        if area < total * min_area_frac:
            continue
            
        x, y, w, h = cv2.boundingRect(c)
        
        # Calculate Confidence Score Math (Extent = area / bounding_box_area)
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
        
    # Sort regions by size, largest first
    regions.sort(key=lambda r: r["area_pct"], reverse=True)
    return regions[:max_regions]


def cv_analyze_rgb(img_bgr):
    """
    Analyzes an RGB optical payload image to determine vegetation health (NDVI proxy),
    fire risk, and detect active burn scars or deforested areas.
    """
    H, W = img_bgr.shape[:2]
    total = H * W
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    # Define color thresholds for different terrain types
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
    
    # Calculate percentage composition of the image
    veg_pct = round(cv2.countNonZero(veg_mask) / total * 100, 1)
    bare_pct = round(cv2.countNonZero(bare_mask) / total * 100, 1)
    burn_pct = round(cv2.countNonZero(burn_mask) / total * 100, 1)
    
    # Calculate a proxy for NDVI using standard RGB channels
    b, g, r = cv2.split(img_bgr.astype(np.float32))
    mean_ndvi = round(float(np.mean((g - r) / (g + r + 1e-6))), 3)
    
    # Calculate edge density to find fragmented forests or logging tracks
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = round(cv2.countNonZero(edges) / total * 100, 1)
    
    # Calculate overall forest health score (0-100)
    health = max(0, min(100, round(
        veg_pct * 0.55 +
        max(0, (mean_ndvi + 0.2) / 1.2 * 100) * 0.30 +
        max(0, 100 - bare_pct * 2 - burn_pct * 4) * 0.15, 1
    )))
    
    # Assign alphabetical grades based on the health score
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
        
    # Determine Risks based on OpenCV analysis
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
        
    # Get bounding boxes for drawing on the frontend
    bare_regions = get_regions(bare_mask, img_bgr.shape, label='Cleared/Deforested')
    burn_regions = get_regions(burn_mask, img_bgr.shape, label='Burn Scar')
    
    return {
        "vegetation_pct": veg_pct, 
        "bare_pct": bare_pct, 
        "burn_pct": burn_pct,
        "ndvi_proxy": mean_ndvi, 
        "edge_density": edge_density,
        "health_score": health, 
        "health_grade": grade,
        "fire_risk": fire_risk, 
        "deforestation_risk": defor_risk,
        "bare_regions": bare_regions, 
        "burn_regions": burn_regions,
    }


def cv_detect_roads(img_bgr):
    """
    Uses Morphological Tophats and Hough Transforms to detect straight 
    unnatural lines (logging roads) inside forests.
    """
    H, W = img_bgr.shape[:2]
    
    blurred = cv2.GaussianBlur(img_bgr, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    
    # Mask out everything except dirt/bare earth
    bare_mask = cv2.inRange(
        hsv, 
        np.array([5, 10, 40]), 
        np.array([35, 220, 255])
    )
    bare_mask_dilated = cv2.dilate(bare_mask, np.ones((15, 15), np.uint8), iterations=2)
    
    # Enhance contrast using CLAHE
    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    
    # Morphological Tophat to isolate thin, bright lines
    k_h = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 1))
    k_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
    
    tophat = cv2.add(
        cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_h), 
        cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k_v)
    )
    
    # Apply the dirt mask to the tophat image
    tophat = cv2.bitwise_and(tophat, tophat, mask=bare_mask_dilated)
    
    # Edge detection
    edges = cv2.Canny(tophat, 50, 150)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8))
    
    # Identify lines (must be at least 10% the width/height of the image)
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
            
        # Ignore perfectly horizontal/vertical artifacts
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
        
        # Draw the line on our mask to calculate total coverage later
        cv2.line(road_pixel_mask, (x1, y1), (x2, y2), 255, thickness=6)
        
    road_coverage = round(cv2.countNonZero(road_pixel_mask) / (H * W) * 100, 2)
    segments.sort(key=lambda s: s["length_pct"], reverse=True)
    
    return {
        "road_segments": segments[:15], 
        "road_count": len(segments),
        "road_coverage_pct": road_coverage
    }


def cv_change_detect(img_a, img_b):
    """
    Compares a 'Before' and 'After' image to determine net changes in 
    vegetation and bare earth.
    """
    # Ensure both images are the exact same size before differencing
    h = min(img_a.shape[0], img_b.shape[0])
    w = min(img_a.shape[1], img_b.shape[1])
    
    a = cv2.resize(img_a, (w, h))
    b = cv2.resize(img_b, (w, h))
    total = h * w
    
    # Calculate absolute difference
    diff = cv2.absdiff(a, b)
    _, thresh = cv2.threshold(cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY), 28, 255, cv2.THRESH_BINARY)
    change_pct = round(cv2.countNonZero(thresh) / total * 100, 1)
    
    def get_veg_pct(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, np.array([35,40,40]), np.array([85,255,255]))
        return cv2.countNonZero(mask) / total * 100
        
    def get_bare_pct(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv, np.array([8,30,40]), np.array([30,220,210]))
        return cv2.countNonZero(mask) / total * 100
        
    va = get_veg_pct(a)
    vb = get_veg_pct(b)
    
    ba = get_bare_pct(a)
    bb = get_bare_pct(b)
    
    # Isolate areas that were NOT bare before, but ARE bare now
    bare_after = cv2.inRange(cv2.cvtColor(b, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))
    bare_before = cv2.inRange(cv2.cvtColor(a, cv2.COLOR_BGR2HSV), np.array([8,30,40]), np.array([30,220,210]))
    new_bare = cv2.bitwise_and(bare_after, cv2.bitwise_not(bare_before))
    
    change_regions_raw = get_regions(thresh, (h, w), label='Changed area')
    new_bare_regions = get_regions(new_bare, (h, w), label='Newly cleared')
    
    dilated = cv2.dilate(thresh, np.ones((7,7), np.uint8), iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    n_regions = len([c for c in contours if cv2.contourArea(c) > total * 0.005])
    
    return {
        "change_pct": change_pct,
        "veg_before": round(va, 1), 
        "veg_after": round(vb, 1), 
        "veg_delta": round(vb - va, 1),
        "bare_before": round(ba, 1), 
        "bare_after": round(bb, 1), 
        "bare_delta": round(bb - ba, 1),
        "change_regions": n_regions, 
        "change_boxes": change_regions_raw, 
        "new_bare_regions": new_bare_regions,
    }


# ==============================================================================
# FLASK ROUTES
# ==============================================================================

@app.route('/')
def index(): 
    """Serves the main frontend UI."""
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:filename>')
def serve_static(filename): 
    """Serves static files (JS, CSS)."""
    return send_from_directory(FRONTEND_DIR, filename)


@app.route('/api/samples')
def list_samples():
    """Lists available satellite images in the samples directory."""
    if not os.path.exists(SAMPLES_DIR): 
        return jsonify([])
        
    valid_files =[f for f in os.listdir(SAMPLES_DIR) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    return jsonify(sorted(valid_files))


@app.route('/samples/<path:filename>')
def serve_sample(filename): 
    """Serves the actual image file to the frontend."""
    return send_from_directory(SAMPLES_DIR, filename)


@app.route('/api/analyze', methods=['POST'])
def analyze_image():
    """Endpoint to run the OpenCV RGB and Road analysis."""
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
    """Endpoint to run the OpenCV Change Detection analysis."""
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


def get_satellite_pos():
    """Calculates the real-time lat/lng of the satellite using Skyfield."""
    ts = load.timescale()
    geo = satellite.at(ts.now())
    sub = geo.subpoint()
    return sub.latitude.degrees, sub.longitude.degrees


# ==============================================================================
# SERIAL THREAD (Real-Time Ingestion - Database Removed)
# ==============================================================================
def read_serial_data():
    """
    Listens to the Serial port for incoming JSON telemetry from the ESP32,
    injects ground-station specific data (like Map location and GS RSSI),
    and pushes it to the UI via WebSockets.
    """
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n📡 Connected to ESP32 on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                # Verify we have a complete JSON string
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        
                        # Inject Ground Station Local Truths
                        # We use Skyfield for the Map Lat/Lng because static simulated GPS is boring on a map!
                        # However, we still pass through the hardware 'gps.alt' to show real hardware data in the UI.
                        lat, lng = get_satellite_pos()
                        data["lat"] = lat
                        data["lng"] = lng
                        data["rssi_gs"] = random.randint(-85, -60)
                        
                        # Emit data immediately to the frontend
                        socketio.emit('telemetry_update', data)
                        
                    except json.JSONDecodeError: 
                        # Ignore malformed packets quietly
                        pass
            
            # Sleep slightly to prevent high CPU usage in the thread
            socketio.sleep(0.01)
            
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}")

if __name__ == '__main__':
    # Start the serial listener in the background
    socketio.start_background_task(read_serial_data)
    # Start the Flask web server
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)