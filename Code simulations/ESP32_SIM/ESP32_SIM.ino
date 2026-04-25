// ==============================================================================
// FORESTGUARD ALPHA - LEO SATELLITE SIMULATOR (ESP32)
// Features: Detailed EPS, FDIR, IMU Attitude, Env Sensors, and GPS
// ==============================================================================

unsigned long lastLoopTime = 0;
unsigned long satelliteUnixTime = 1713170000; 

// --- Orbital Pass Simulation ---
bool inPass = false;
unsigned long passTimer = 0;
const unsigned long PASS_DURATION = 40000; // 40 seconds over Ground Station
const unsigned long LOS_DURATION = 20000;  // 20 seconds out of range

// --- Core Subsystem Variables ---
float obc_temp = 30.0;      
float payload_temp = 25.0;  
int rssi_uplink = -85;      
int rssi_gsn = -90;         

// --- EPS (Electrical Power Subsystem) ---
float eps_soc = 85.0;       
float eps_v_bat = 8.0;      
float eps_v_3v3 = 3.3;      
float eps_v_5v = 5.02;      
float eps_temp = 24.0;      
int eps_i_in = 0;           
int eps_i_out = 0;          
int eps_i_payload = 0;      
int eps_i_comms = 0;        
int eps_i_obc = 150;        

// --- NEW: FLIGHT DYNAMICS (IMU) & ENVIRONMENT ---
float att_pitch = 0.0;
float att_roll = 0.0;
float att_yaw = 0.0;
float env_pressure = 1013.25; // Standard internal pressure (hPa)
float env_humidity = 12.0;    // Low humidity inside satellite canister (%)
float gps_alt = 405.5;        // Altitude in km

// --- Mission Modes & FDIR ---
int payload_state = 0; 
bool fdir_override = false; 

void setup() {
    Serial.begin(115200);
    randomSeed(analogRead(0));
    passTimer = millis(); 
}

void loop() {
    // Run exactly once per second
    if (millis() - lastLoopTime >= 1000) {
        lastLoopTime = millis();
        satelliteUnixTime++; 

        // 1. ORBIT DYNAMICS (AOS/LOS)
        if (inPass && (millis() - passTimer > PASS_DURATION)) {
            inPass = false; 
            passTimer = millis();
        } else if (!inPass && (millis() - passTimer > LOS_DURATION)) {
            inPass = true;  
            passTimer = millis();
            payload_state = 2; 
        }

        // 2. MISSION SCHEDULING
        if (!inPass && random(0, 100) < 5 && payload_state == 0) {
            payload_state = 1; 
        } else if (payload_state == 1 && random(0, 100) < 20) {
            payload_state = 0; 
        }

        // 3. ON-BOARD AUTONOMY (FDIR)
        if (!fdir_override) {
            if (payload_temp > 55.0 || eps_soc < 20.0) {
                payload_state = 0; 
            }
        } else {
            if (eps_v_bat <= 6.0) {
                payload_state = 0; 
            }
        }

        // 4. DETAILED POWER DYNAMICS
        eps_i_in = random(0, 100) > 20 ? random(800, 1200) : 0; 
        
        if (payload_state == 1) {
            eps_i_payload = random(600, 800); 
        } else if (payload_state == 2) {
            eps_i_payload = random(100, 150); 
        } else {
            eps_i_payload = 0; 
        }
        
        if (inPass) {
            eps_i_comms = random(250, 350); 
        } else {
            eps_i_comms = random(40, 60);   
        }
        
        eps_i_obc = random(140, 160); 
        eps_i_out = eps_i_payload + eps_i_comms + eps_i_obc; 
        
        float net_amps = (eps_i_in - eps_i_out) / 1000.0;
        eps_soc += (net_amps * 0.1); 
        eps_soc = constrain(eps_soc, 0.0, 100.0);
        
        float ideal_voltage = 6.0 + ((eps_soc / 100.0) * 2.4);
        float voltage_sag = (eps_i_out / 1000.0) * 0.15; 
        eps_v_bat = ideal_voltage - voltage_sag;

        eps_v_3v3 = 3.3 + (random(-2, 2) / 100.0);
        if (payload_state > 0) {
            eps_v_5v = 4.95 + (random(-5, 5) / 100.0);
        } else {
            eps_v_5v = 5.02;
        }

        // 5. THERMAL DYNAMICS
        obc_temp = 30.0 + (eps_i_out / 200.0) + random(-1, 2); 
        eps_temp = 20.0 + (abs(net_amps) * 5.0);
        
        if (payload_state == 1) {
            payload_temp += 1.5; 
        } else {
            payload_temp -= 2.0; 
        }
        float ambient_temp = 5.0 + random(-2, 2);
        payload_temp = constrain(payload_temp, ambient_temp, 80.0);

        // 6. NEW: SIMULATE FLIGHT DYNAMICS & ENVIRONMENT
        // Smooth sine/cosine waves to simulate orbital tumbling/stabilization
        att_pitch = sin(satelliteUnixTime * 0.1) * 3.0; // +/- 3 degrees
        att_roll = cos(satelliteUnixTime * 0.1) * 2.0;  // +/- 2 degrees
        att_yaw = (satelliteUnixTime % 360) - 180.0;    // Sweeps -180 to 180

        env_pressure = 1013.2 + (random(-5, 5) / 10.0); // Slight fluctuations
        env_humidity = 12.0 + (random(-2, 2) / 10.0);   // Stable internal humidity
        gps_alt = 405.5 + (random(-10, 10) / 10.0);     // Orbiting around 405km

        // 7. TRANSMIT DOWNLINK (ONLY DURING PASS)
        if (inPass) {
            Serial.print("{");
            Serial.print("\"type\":\"TELEMETRY\",");
            Serial.print("\"timestamp\":"); Serial.print(satelliteUnixTime); Serial.print(",");
            
            Serial.print("\"fdir_mode\":\""); Serial.print(fdir_override ? "OVERRIDE" : "AUTO"); Serial.print("\",");
            Serial.print("\"payload_state\":"); Serial.print(payload_state); Serial.print(",");
            
            Serial.print("\"obc_temp\":"); Serial.print(obc_temp); Serial.print(",");
            Serial.print("\"payload_temp\":"); Serial.print(payload_temp); Serial.print(",");
            Serial.print("\"rssi_uplink\":"); Serial.print(rssi_uplink); Serial.print(",");
            Serial.print("\"rssi_gsn\":"); Serial.print(random(-95, -70)); Serial.print(","); 
            
            // Nested EPS JSON
            Serial.print("\"eps\":{");
            Serial.print("\"soc\":"); Serial.print(eps_soc); Serial.print(",");
            Serial.print("\"v_bat\":"); Serial.print(eps_v_bat); Serial.print(",");
            Serial.print("\"v_3v3\":"); Serial.print(eps_v_3v3); Serial.print(",");
            Serial.print("\"v_5v\":"); Serial.print(eps_v_5v); Serial.print(",");
            Serial.print("\"i_in\":"); Serial.print(eps_i_in); Serial.print(",");
            Serial.print("\"i_out\":"); Serial.print(eps_i_out); Serial.print(",");
            Serial.print("\"i_payload\":"); Serial.print(eps_i_payload); Serial.print(",");
            Serial.print("\"i_comms\":"); Serial.print(eps_i_comms); Serial.print(",");
            Serial.print("\"temp\":"); Serial.print(eps_temp);
            Serial.print("},");
            
            // NEW: Nested Attitude & Environment JSON
            Serial.print("\"attitude\":{");
            Serial.print("\"pitch\":"); Serial.print(att_pitch); Serial.print(",");
            Serial.print("\"roll\":"); Serial.print(att_roll); Serial.print(",");
            Serial.print("\"yaw\":"); Serial.print(att_yaw);
            Serial.print("},");
            
            Serial.print("\"env\":{");
            Serial.print("\"pressure\":"); Serial.print(env_pressure); Serial.print(",");
            Serial.print("\"humidity\":"); Serial.print(env_humidity);
            Serial.print("},");
            
            Serial.print("\"gps\":{");
            Serial.print("\"alt\":"); Serial.print(gps_alt);
            Serial.print("},");

            // THERMAL SCANNER ARRAY
            bool fireDetected = random(0, 100) < 15; 
            int firePixel = random(0, 64); 
            
            Serial.print("\"thermal\":[");
            for (int i = 0; i < 64; i++) {
                float pixelTemp = random(200, 260) / 10.0; 
                if (fireDetected && i == firePixel) {
                    pixelTemp = random(700, 900) / 10.0; 
                }
                Serial.print(pixelTemp);
                if (i < 63) {
                    Serial.print(",");
                }
            }
            Serial.print("]");
            Serial.println("}"); 
        }
    }
}