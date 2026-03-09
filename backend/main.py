import serial
import json
import asyncio
from fastapi import FastAPI
import socketio

# --- CONFIGURATION ---
SERIAL_PORT = 'COM11'  # <--- CHANGE THIS TO YOUR ARDUINO PORT (e.g., 'COM4', 'COM5')
BAUD_RATE = 115200

# --- SETUP SERVER & WEBSOCKETS ---
app = FastAPI()
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
combined_app = socketio.ASGIApp(sio, app)

# --- SERIAL READING LOOP ---
async def read_serial_data():
    try:
        # Open the connection to the ESP32
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"🛰️ SUCCESS: Connected to ESP32 on {SERIAL_PORT}")
        
        while True:
            if ser.in_waiting > 0:
                # Read the line of data and decode it into text
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                # Check if it looks like our JSON package
                if line.startswith("{") and line.endswith("}"):
                    try:
                        # Turn the text into a Python dictionary
                        data = json.loads(line)
                        
                        # Shout it through the WebSocket to the frontend!
                        await sio.emit('telemetry_update', data)
                        print(f"📡 Broadcasted -> Battery: {data['battery']}%, RSSI: {data['rssi']}dBm")
                    except json.JSONDecodeError:
                        pass # Ignore a broken line if the USB cable gets bumped
                        
            await asyncio.sleep(0.01) # Prevents Python from hogging your CPU
            
    except Exception as e:
        print(f"\n❌ ERROR: Could not connect to {SERIAL_PORT}.")
        print(f"Did you close the Arduino Serial Monitor? Is the ESP32 plugged in? Error: {e}")

# Start the reading loop when the server boots
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(read_serial_data())

@app.get("/")
def read_root():
    return {"status": "ForestGuard GS API is running!"}