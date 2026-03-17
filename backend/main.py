import serial
import json
import os
from flask import Flask, send_from_directory
from flask_socketio import SocketIO

# --- CONFIGURATION ---
SERIAL_PORT = 'COM11'  # Matches your ESP32 port
BAUD_RATE = 115200

# Locate the frontend folder so Flask can serve your HTML/CSS/JS
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "../frontend/public"))

# --- INITIALIZE FLASK & SOCKET.IO ---
app = Flask(__name__)
# Wide open CORS so the browser never blocks the connection
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# --- ORBITAL SIMULATION VARIABLES ---
sat_lat = -4.0  # Starting near southern Kenya
sat_lng = 39.0
orbit_speed = 0.005

# --- FLASK WEB ROUTES ---
@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory(FRONTEND_DIR, filename)

# --- SERIAL READING BACKGROUND THREAD ---
def read_serial_data():
    global sat_lat, sat_lng
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"\n🛰️ FLASK SUCCESS: Connected to ESP32 on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        
                        # --- ORBITAL MOVEMENT LOGIC ---
                        sat_lat += orbit_speed
                        sat_lng -= (orbit_speed * 0.5)
                        if sat_lat > 5.0:  # Loop back when it goes too far North
                            sat_lat = -4.0
                            sat_lng = 39.0
                            
                        data["lat"] = sat_lat
                        data["lng"] = sat_lng

                        # Broadcast via Flask-SocketIO
                        socketio.emit('telemetry_update', data)
                    except json.JSONDecodeError:
                        pass
            
            # CRITICAL: We MUST use socketio.sleep, not time.sleep!
            socketio.sleep(0.01) 
            
    except Exception as e:
        print(f"\n❌ SERIAL ERROR: {e}")

# --- START THE SERVER ---
if __name__ == '__main__':
    print("🚀 Starting ForestGuard GS Flask Server on http://localhost:8000")
    # Start the hardware loop the "Socket.IO way"
    socketio.start_background_task(read_serial_data)
    socketio.run(app, host='0.0.0.0', port=8000, allow_unsafe_werkzeug=True)