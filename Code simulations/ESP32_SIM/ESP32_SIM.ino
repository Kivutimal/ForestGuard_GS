// ==============================================================================
// SATELLITE TELEMETRY & EPS SIMULATOR (ESP32)
// This firmware simulates realistic Electrical Power Subsystem (EPS) behavior,
// including solar generation, battery charging/discharging, and payload loads.
// ==============================================================================

unsigned long lastTransmission = 0;

// --- Simulated System Variables ---
int rssi = -75;
float sysTemp = 22.0;

// --- Simulated EPS (Electrical Power Subsystem) Variables ---
float eps_soc = 85.0;       // State of Charge (%)
float eps_v_bat = 8.0;      // Battery Voltage (V) - assuming 2S LiPo (6.0V - 8.4V)
float eps_temp = 24.0;      // Battery Temperature (°C)
int eps_i_in = 0;           // Solar generation current (mA)
int eps_i_out = 0;          // Total satellite draw current (mA)
int eps_i_payload = 150;    // Payload-specific draw (mA)

void setup() {
    // Start the Serial communication matching our Python backend
    Serial.begin(115200);
    randomSeed(analogRead(0));
}

void loop() {
    // Transmit data every 2000 milliseconds (2 seconds)
    if (millis() - lastTransmission > 2000) {
        lastTransmission = millis();

        // ---------------------------------------------------------
        // 1. UPDATE SIMULATED EPS MATH (Realistic charging/discharging)
        // ---------------------------------------------------------
        
        // Simulate satellite passing in and out of sunlight (0mA to 1200mA)
        eps_i_in = random(0, 100) > 30 ? random(800, 1200) : 0; 
        
        // Simulate normal payload draw with an occasional "anomaly spike" (Single Event Latch-up)
        bool payload_latchup = random(0, 100) < 5; // 5% chance of current spike
        eps_i_payload = payload_latchup ? random(600, 800) : random(100, 180);
        
        // Total draw = payload + base satellite operations (comms, mcu, etc.)
        eps_i_out = eps_i_payload + random(200, 300); 

        // Calculate net power flow (convert mA to A for SoC calculation)
        float net_current_amps = (eps_i_in - eps_i_out) / 1000.0;
        
        // Integrate current over time to affect battery percentage
        eps_soc += (net_current_amps * 0.5); // Multiplier speeds up the simulation visually
        if (eps_soc > 100.0) eps_soc = 100.0;
        if (eps_soc < 0.0) eps_soc = 0.0;

        // Simulate Voltage based on SoC (Linear estimation for 2S LiPo: 6.0V dead, 8.4V full)
        eps_v_bat = 6.0 + ((eps_soc / 100.0) * 2.4);

        // Simulate battery temp rising during heavy discharge or charge
        eps_temp = 20.0 + (abs(net_current_amps) * 5.0) + random(-1, 2);

        // Simulate Basic System metrics
        rssi = random(-95, -65);
        sysTemp = random(150, 250) / 10.0;

        // ---------------------------------------------------------
        // 2. THERMAL SENSOR SIMULATION (Existing logic)
        // ---------------------------------------------------------
        bool fireDetected = random(0, 100) < 15; // 15% chance of a fire spike
        int firePixel = random(0, 64); 

        // ---------------------------------------------------------
        // 3. PACKAGE & SEND NESTED JSON
        // ---------------------------------------------------------
        Serial.print("{");
        Serial.print("\"type\":\"TELEMETRY\",");
        
        // Basic System Data
        Serial.print("\"rssi\":"); Serial.print(rssi); Serial.print(",");
        Serial.print("\"sysTemp\":"); Serial.print(sysTemp); Serial.print(",");
        
        // EPS Subsystem Data (Nested Object)
        Serial.print("\"eps\":{");
        Serial.print("\"soc\":"); Serial.print(eps_soc); Serial.print(",");
        Serial.print("\"v_bat\":"); Serial.print(eps_v_bat); Serial.print(",");
        Serial.print("\"i_in\":"); Serial.print(eps_i_in); Serial.print(",");
        Serial.print("\"i_out\":"); Serial.print(eps_i_out); Serial.print(",");
        Serial.print("\"i_payload\":"); Serial.print(eps_i_payload); Serial.print(",");
        Serial.print("\"temp\":"); Serial.print(eps_temp);
        Serial.print("},");
        
        // Legacy variable for backwards compatibility if needed
        Serial.print("\"battery\":"); Serial.print(eps_soc); Serial.print(",");

        // Thermal Data Array
        Serial.print("\"thermal\":[");
        for (int i = 0; i < 64; i++) {
            float pixelTemp = random(200, 260) / 10.0; 
            if (fireDetected && i == firePixel) {
                pixelTemp = random(700, 900) / 10.0; 
            }
            Serial.print(pixelTemp);
            if (i < 63) Serial.print(",");
        }
        Serial.print("]");
        Serial.println("}"); 
    }
}