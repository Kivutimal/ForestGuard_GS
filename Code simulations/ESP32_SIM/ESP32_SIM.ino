// ==============================================================================
// FORESTGUARD_KENYA - FULL SYSTEM SIMULATOR (Single ESP32)
// Features: Detailed EPS, FDIR, Env Sensors, GPS Altitude, and GSN Data Downlink
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
// ENVIRONMENT & GPS VARIABLES (IMU Removed)
// ---------------------------------------------------------
float env_pressure = 1013.25; 
float env_humidity = 12.0;    
float gps_alt = 405.5;        

// ---------------------------------------------------------
// MISSION MODES & FDIR
// ---------------------------------------------------------
// Payload States: 0 = OFF, 1 = IMAGING, 2 = DOWNLINKING
int payload_state = 0; 
bool fdir_override = false; 

// ---------------------------------------------------------
// STORE-AND-FORWARD CACHE (Delay Tolerant Networking)
// ---------------------------------------------------------
bool has_cached_gsn = false;
unsigned long gsn_timestamp = 0;
float gsn_temp = 0.0;
float gsn_hum = 0.0;
int gsn_soil = 0;
int gsn_smoke = 0;
int gsn_sound = 0;
float gsn_v_bat = 0.0;
int gsn_soc = 0;
int rssi_gsn = -100;

void setup() {
    // Communication with Python Backend
    Serial.begin(115200);
    randomSeed(analogRead(0));
}

void loop() {
    // Run the main simulation loop exactly once per second
    if (millis() - lastLoopTime >= 1000) {
        lastLoopTime = millis();
        satelliteUnixTime++; 

        // =========================================================
        // 1. ORBITAL PHASE CALCULATOR
        // =========================================================
        int current_phase = satelliteUnixTime % 90; // 90 second simulated orbit
        
        // Seconds 0 to 20: Flying over the Forest (Pinging Ground Sensors)
        bool in_gsn_pass = (current_phase >= 0 && current_phase < 20);
        
        // Seconds 45 to 65: Flying over Juja Ground Station (Downlinking)
        if (current_phase == 45) {
            inPass = true;
            payload_state = 2; // Auto-start SD Card Read for Downlink
        } else if (current_phase == 65) {
            inPass = false;
        }

        // =========================================================
        // 2. GROUND SENSOR NETWORK (GSN) DATA COLLECTION
        // =========================================================
        if (in_gsn_pass) {
            has_cached_gsn = true;
            gsn_timestamp = satelliteUnixTime; 
            rssi_gsn = random(-95, -70);
            gsn_smoke = random(0, 100) < 5 ? 1 : 0; 
            gsn_sound = random(0, 100) < 8 ? 1 : 0; 
            gsn_temp = 24.5 + (random(-15, 15) / 10.0);
            gsn_hum = 78.2 + (random(-50, 50) / 10.0);
            gsn_soil = 45 + random(-5, 5);
            gsn_v_bat = 7.82 - (random(0, 5) / 100.0);
            gsn_soc = 85 - random(0, 2);
        }

        // =========================================================
        // 3. MISSION SCHEDULING & FDIR
        // =========================================================
        if (!inPass && random(0, 100) < 5 && payload_state == 0) {
            payload_state = 1; // Start ROI Imaging
        } else if (payload_state == 1 && random(0, 100) < 20) {
            payload_state = 0; // End Imaging
        }

        // FDIR Autonomy overrides
        if (!fdir_override) {
            if (payload_temp > 55.0 || eps_soc < 20.0) payload_state = 0; 
        } else if (eps_v_bat <= 6.0) {
            payload_state = 0; // Hardware BMS cutoff
        }

        // =========================================================
        // 4. DETAILED POWER DYNAMICS
        // =========================================================
        eps_i_in = random(0, 100) > 20 ? random(800, 1200) : 0; 
        
        if (payload_state == 1) eps_i_payload = random(600, 800); 
        else if (payload_state == 2) eps_i_payload = random(100, 150); 
        else eps_i_payload = 0; 
        
        if (inPass || in_gsn_pass) eps_i_comms = random(250, 350); 
        else eps_i_comms = random(40, 60); 
        
        eps_i_obc = random(140, 160); 
        eps_i_out = eps_i_payload + eps_i_comms + eps_i_obc; 
        
        float net_amps = (eps_i_in - eps_i_out) / 1000.0;
        eps_soc += (net_amps * 0.1); 
        eps_soc = constrain(eps_soc, 0.0, 100.0);
        
        float ideal_voltage = 6.0 + ((eps_soc / 100.0) * 2.4);
        float voltage_sag = (eps_i_out / 1000.0) * 0.15; 
        eps_v_bat = ideal_voltage - voltage_sag;

        eps_v_3v3 = 3.3 + (random(-2, 2) / 100.0);
        eps_v_5v = (payload_state > 0) ? 4.95 + (random(-5, 5) / 100.0) : 5.02;

        // =========================================================
        // 5. THERMAL DYNAMICS & ENVIRONMENT
        // =========================================================
        obc_temp = 30.0 + (eps_i_out / 200.0) + random(-1, 2); 
        eps_temp = 20.0 + (abs(net_amps) * 5.0);
        
        if (payload_state == 1) payload_temp += 1.5; 
        else payload_temp -= 2.0; 
        payload_temp = constrain(payload_temp, 5.0 + random(-2, 2), 80.0);

        env_pressure = 1013.2 + (random(-5, 5) / 10.0); 
        env_humidity = 12.0 + (random(-2, 2) / 10.0);   
        gps_alt = 405.5 + (random(-10, 10) / 10.0);     

        // =========================================================
        // 6. TRANSMIT DOWNLINK (CSV FORMAT) VIA USB
        // =========================================================
        if (inPass) {
            // Simulated Ground Station Header
            int simulated_gs_rssi = random(-85, -60);
            Serial.print("TLM_RCV,");
            Serial.print(simulated_gs_rssi); Serial.print(",");
            
            // Start of Satellite Payload
            Serial.print("TLM,");
            Serial.print(satelliteUnixTime); Serial.print(",");
            Serial.print(fdir_override ? "OVERRIDE" : "AUTO"); Serial.print(",");
            Serial.print(payload_state); Serial.print(",");
            Serial.print(obc_temp, 1); Serial.print(",");
            Serial.print(payload_temp, 1); Serial.print(",");
            Serial.print(rssi_uplink); Serial.print(",");
            
            // EPS (9 items)
            Serial.print(eps_soc, 1); Serial.print(",");
            Serial.print(eps_v_bat, 2); Serial.print(",");
            Serial.print(eps_v_3v3, 2); Serial.print(",");
            Serial.print(eps_v_5v, 2); Serial.print(",");
            Serial.print(eps_i_in); Serial.print(",");
            Serial.print(eps_i_out); Serial.print(",");
            Serial.print(eps_i_payload); Serial.print(",");
            Serial.print(eps_i_comms); Serial.print(",");
            Serial.print(eps_temp, 1); Serial.print(",");
            
            // ENV & GPS (3 items)
            Serial.print(env_pressure, 1); Serial.print(",");
            Serial.print(env_humidity, 1); Serial.print(",");
            Serial.print(gps_alt, 1); Serial.print(",");
            
            // GSN
            if (has_cached_gsn) {
                Serial.print("1,"); // Flag indicating GSN data follows
                Serial.print(gsn_timestamp); Serial.print(",");
                Serial.print("GSN-01,");
                Serial.print(rssi_gsn); Serial.print(",");
                Serial.print(gsn_temp, 1); Serial.print(",");
                Serial.print(gsn_hum, 1); Serial.print(",");
                Serial.print(gsn_soil); Serial.print(",");
                Serial.print(gsn_smoke); Serial.print(",");
                Serial.print(gsn_sound); Serial.print(",");
                Serial.print(gsn_v_bat, 2); Serial.print(",");
                Serial.print(gsn_soc); Serial.print(",");
            } else {
                Serial.print("0,"); // Flag indicating NO GSN data
            }

            // THERMAL SCANNER ARRAY (64 comma-separated values)
            bool fireDetected = random(0, 100) < 15; 
            int firePixel = random(0, 64); 
            
            for (int i = 0; i < 64; i++) {
                float pixelTemp = random(200, 260) / 10.0; 
                if (fireDetected && i == firePixel) {
                    pixelTemp = random(700, 900) / 10.0; 
                }
                Serial.print(pixelTemp, 1);
                if (i < 63) Serial.print(",");
            }
            Serial.println(); // End the CSV row
        }
    }
}