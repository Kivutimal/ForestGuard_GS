// ==============================================================================
// FORESTGUARD ALPHA - LEO SATELLITE SIMULATOR (ESP32)
// Features: Detailed EPS, FDIR, IMU, Env Sensors, GPS, and GSN Data Downlink
// ==============================================================================

unsigned long lastLoopTime = 0;
// Start at a fixed UNIX timestamp for consistent testing
unsigned long satelliteUnixTime = 1713170000; 

// ---------------------------------------------------------
// ORBITAL PASS SIMULATION VARIABLES
// ---------------------------------------------------------
bool inPass = false;
unsigned long passTimer = 0;
const unsigned long PASS_DURATION = 40000; // 40 seconds over Ground Station
const unsigned long LOS_DURATION = 20000;  // 20 seconds out of range

// ---------------------------------------------------------
// CORE SUBSYSTEM & THERMAL VARIABLES
// ---------------------------------------------------------
float obc_temp = 30.0;      
float payload_temp = 25.0;  
int rssi_uplink = -85;      
int rssi_gsn = -90;         

// ---------------------------------------------------------
// ELECTRICAL POWER SUBSYSTEM (EPS) VARIABLES
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// FLIGHT DYNAMICS (IMU) & ENVIRONMENT VARIABLES
// ---------------------------------------------------------
float att_pitch = 0.0;
float att_roll = 0.0;
float att_yaw = 0.0;
float env_pressure = 1013.25; 
float env_humidity = 12.0;    
float gps_alt = 405.5;        

// ---------------------------------------------------------
// MISSION MODES & FDIR
// ---------------------------------------------------------
// Payload States: 0 = OFF, 1 = IMAGING, 2 = DOWNLINKING
int payload_state = 0; 
bool fdir_override = false; 

void setup() {
    Serial.begin(115200);
    randomSeed(analogRead(0));
    passTimer = millis(); 
}

void loop() {
    // Run the main simulation loop exactly once per second
    if (millis() - lastLoopTime >= 1000) {
        lastLoopTime = millis();
        satelliteUnixTime++; 

        // =========================================================
        // 1. ORBIT DYNAMICS (AOS/LOS PHASE TRANSITIONS)
        // =========================================================
        if (inPass && (millis() - passTimer > PASS_DURATION)) {
            // Satellite has gone over the horizon (Loss of Signal)
            inPass = false; 
            passTimer = millis();
        } else if (!inPass && (millis() - passTimer > LOS_DURATION)) {
            // Satellite has appeared over the horizon (Acquisition of Signal)
            inPass = true;  
            passTimer = millis();
            // Automatically start downlinking SD card data when in pass
            payload_state = 2; 
        }

        // =========================================================
        // 2. MISSION SCHEDULING
        // =========================================================
        // If out of pass, occasionally turn on payload to take photos over forests
        if (!inPass && random(0, 100) < 5 && payload_state == 0) {
            payload_state = 1; 
        } else if (payload_state == 1 && random(0, 100) < 20) {
            // Turn off imaging after a random duration
            payload_state = 0; 
        }

        // =========================================================
        // 3. ON-BOARD AUTONOMY (FDIR)
        // =========================================================
        if (!fdir_override) {
            // Soft Isolation: Protect battery and thermals
            if (payload_temp > 55.0 || eps_soc < 20.0) {
                payload_state = 0; 
            }
        } else {
            // Hardware BMS Deadman Switch (Overrides everything)
            if (eps_v_bat <= 6.0) {
                payload_state = 0; 
            }
        }

        // =========================================================
        // 4. DETAILED POWER DYNAMICS
        // =========================================================
        
        // Solar panels only generate power when in sunlight
        eps_i_in = random(0, 100) > 20 ? random(800, 1200) : 0; 
        
        // Determine Payload current based on its operational state
        if (payload_state == 1) {
            eps_i_payload = random(600, 800); // Heavy AI processing
        } else if (payload_state == 2) {
            eps_i_payload = random(100, 150); // Reading SD Card
        } else {
            eps_i_payload = 0; 
        }
        
        // Determine Communications current based on orbital position
        if (inPass) {
            eps_i_comms = random(250, 350); // Active downlink to Ground Station
        } else {
            eps_i_comms = random(40, 60);   // Idle listening to Ground Sensor Network
        }
        
        eps_i_obc = random(140, 160); 
        eps_i_out = eps_i_payload + eps_i_comms + eps_i_obc; 
        
        // Update State of Charge based on net current flow
        float net_amps = (eps_i_in - eps_i_out) / 1000.0;
        eps_soc += (net_amps * 0.1); 
        eps_soc = constrain(eps_soc, 0.0, 100.0);
        
        // Simulate voltage dropping physically when components pull heavy current
        float ideal_voltage = 6.0 + ((eps_soc / 100.0) * 2.4);
        float voltage_sag = (eps_i_out / 1000.0) * 0.15; 
        eps_v_bat = ideal_voltage - voltage_sag;

        // Simulate 3.3V and 5.0V regulated buses
        eps_v_3v3 = 3.3 + (random(-2, 2) / 100.0);
        if (payload_state > 0) {
            eps_v_5v = 4.95 + (random(-5, 5) / 100.0);
        } else {
            eps_v_5v = 5.02;
        }

        // =========================================================
        // 5. THERMAL DYNAMICS
        // =========================================================
        obc_temp = 30.0 + (eps_i_out / 200.0) + random(-1, 2); 
        eps_temp = 20.0 + (abs(net_amps) * 5.0);
        
        if (payload_state == 1) {
            payload_temp += 1.5; // Rapid heating during imaging
        } else {
            payload_temp -= 2.0; // Radiative cooling when off
        }
        
        float ambient_temp = 5.0 + random(-2, 2);
        payload_temp = constrain(payload_temp, ambient_temp, 80.0);

        // =========================================================
        // 6. FLIGHT DYNAMICS & ENVIRONMENT
        // =========================================================
        att_pitch = sin(satelliteUnixTime * 0.1) * 3.0; 
        att_roll = cos(satelliteUnixTime * 0.1) * 2.0;  
        att_yaw = (satelliteUnixTime % 360) - 180.0;    

        env_pressure = 1013.2 + (random(-5, 5) / 10.0); 
        env_humidity = 12.0 + (random(-2, 2) / 10.0);   
        gps_alt = 405.5 + (random(-10, 10) / 10.0);     

        // =========================================================
        // 7. TRANSMIT DOWNLINK JSON (ONLY DURING PASS)
        // =========================================================
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
            
            // Nested Attitude & Environment JSON
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

            // Nested Ground Sensor Network (GSN) Data Simulation
            int gsn_smoke = random(0, 100) < 5 ? 1 : 0; 
            int gsn_sound = random(0, 100) < 8 ? 1 : 0; 
            float gsn_temp = 24.5 + (random(-15, 15) / 10.0);
            float gsn_hum = 78.2 + (random(-50, 50) / 10.0);
            int gsn_soil = 45 + random(-5, 5);
            float gsn_v_bat = 7.82 - (random(0, 5) / 100.0);
            int gsn_soc = 85 - random(0, 2);

            Serial.print("\"gsn\":{");
            Serial.print("\"node_id\":\"GSN-01\",");
            Serial.print("\"temp\":"); Serial.print(gsn_temp); Serial.print(",");
            Serial.print("\"hum\":"); Serial.print(gsn_hum); Serial.print(",");
            Serial.print("\"soil\":"); Serial.print(gsn_soil); Serial.print(",");
            Serial.print("\"smoke\":"); Serial.print(gsn_smoke); Serial.print(",");
            Serial.print("\"sound\":"); Serial.print(gsn_sound); Serial.print(",");
            Serial.print("\"v_bat\":"); Serial.print(gsn_v_bat); Serial.print(",");
            Serial.print("\"soc\":"); Serial.print(gsn_soc);
            Serial.print("},");

            // =========================================================
            // THERMAL SCANNER ARRAY GENERATOR (Sent to UI for rendering)
            // =========================================================
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