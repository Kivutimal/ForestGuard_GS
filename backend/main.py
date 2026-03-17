import serial
import json
import os
from flask import Flask, send_from_directory
from flask_socketio import SocketIO
from skyfield.api import load, EarthSatellite

# --- CONFIGURATION ---
SERIAL_PORT = 'COM11'  # Matches your ESP32 port
BAUD_RATE = 115200

# --- 🛰️ REAL ORBITAL ENGINE SETUP ---
# This is a TLE (Two-Line Element) for the ISS. 
# It tells Python the exact shape of the orbit.
line1 = '1 25544U 98067A   24068.52554230  .00015566  00000-0  27929-3 0  9991'
line2 = '2 25544  51.6416 287.0505 0004453 118.0055 316.3684 15.49528654442971'
satellite = EarthSatellite(line1, line2, 'ForestGuard-Alpha', load.timescale())

# Locate the frontend folder
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

def get_satellite_pos():
    """Calculates exactly where the satellite is RIGHT NOW in the real world"""
    ts = load.timescale()
    t = ts.now()
    geocentric = satellite.at(t)
    subpoint = geocentric.subpoint()
    return subpoint.latitude.degrees, subpoint.longitude.degrees

# --- FLASK WEB ROUTES ---
@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)

# --- SERIAL READING BACKGROUND THREAD ---
def read_serial_data():
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n🛰️ TRACKER ACTIVE: Connected to ESP32 on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        
                        # --- GET REAL-TIME POSITION ---
                        lat, lng = get_satellite_pos()
                        data["lat"] = lat
                        data["lng"] = lng

                        # Broadcast via Flask-SocketIO
                        socketio.emit('telemetry_update', data)
                    except json.JSONDecodeError:
                        pass
            
            socketio.sleep(0.01) 
            
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}")

if __name__ == '__main__':
    print("🚀 Starting ForestGuard GS Flight Server on http://localhost:8000")
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)