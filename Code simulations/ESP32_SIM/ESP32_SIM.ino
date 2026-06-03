// ==============================================================================
// FORESTGUARD ALPHA - LEO SATELLITE SIMULATOR (ESP32 OBC)
// Upgraded with: SD Tracking, Resolution Params, & Normal Time Scheduling
// ==============================================================================
#include <time.h> // Required for time string formatting

unsigned long lastLoopTime = 0;
unsigned long satelliteUnixTime = 1713170000; // Simulated start time

bool inPass = false;
unsigned long passTimer = 0;
const unsigned long PASS_DURATION = 40000;
const unsigned long LOS_DURATION = 20000;  

float obc_temp = 30.0;      
float payload_temp = 25.0;  
int rssi_uplink = -85;      

float eps_soc = 85.0;       
float eps_v_bat = 8.0;      
float eps_v_3v3 = 3.3;      
float eps_v_5v_1 = 5.02;    // Payload Bus
float eps_v_5v_2 = 5.01;    // Comms Bus
float eps_v_5v_3 = 5.03;    // Aux/Sensor Bus      
float eps_temp = 24.0;      
int eps_i_in = 0;           
int eps_i_out = 0;          
int eps_i_payload = 0;      
int eps_i_comms = 0;        
int eps_i_obc = 150;        

float env_pressure = 1013.25; 
float env_humidity = 12.0;    
float gps_alt = 405.5;        

int payload_state = 0; 
bool fdir_override = false; 

// --- SD Card Storage Simulators ---
float obc_sd_used = 12.4;     
float payload_sd_used = 45.1; 
float gsn_sd_used = 8.5;      

// --- Payload Image Resolution ---
int image_resolution = 1080; 

// ---------------------------------------------------------
// TELECOMMAND QUEUE (Using Normal Time Strings)
// ---------------------------------------------------------
#define MAX_TASKS 5
struct ScheduledTask {
    String executeAt; // Matches format YYYYMMDD_HHMMSS
    String command;
    bool isPending;
};
ScheduledTask taskQueue[MAX_TASKS];

bool scheduleCommand(String execTime, String cmd) {
    for (int i = 0; i < MAX_TASKS; i++) {
        if (!taskQueue[i].isPending) {
            taskQueue[i].executeAt = execTime;
            taskQueue[i].command = cmd;
            taskQueue[i].isPending = true;
            return true;
        }
    }
    return false;
}

void executeCommand(String cmd) {
    if (cmd == "PAYLOAD:ON" || cmd == "PAYLOAD:CAPTURE,60") {
        payload_state = 1;
        Serial.println("TLM_MSG,Payload powered ON (Imaging Mode)");
    } 
    else if (cmd == "PAYLOAD:OFF") {
        payload_state = 0;
        Serial.println("TLM_MSG,Payload powered OFF");
    }
    else if (cmd == "FDIR:OVERRIDE") {
        fdir_override = true;
        Serial.println("TLM_MSG,FDIR Mode set to OVERRIDE (Manual Control)");
    }
    else if (cmd == "FDIR:AUTO") {
        fdir_override = false;
        Serial.println("TLM_MSG,FDIR Mode set to AUTO (Autonomous Survival)");
    }
    else if (cmd.startsWith("RES:")) {
        image_resolution = cmd.substring(4).toInt();
        Serial.print("TLM_MSG,Payload resolution updated to ");
        Serial.print(image_resolution);
        Serial.println("p");
    }
    else if (cmd == "OBC:PING") {
        Serial.println("TLM_MSG,OBC PONG - System nominal");
    }
    else if (cmd == "PAYLOAD:PING") {
        Serial.println("TLM_MSG,PAYLOAD PONG - Optics nominal");
    }
    
    // ==========================================
    // NEW: SIMULATED DATA RETRIEVAL RESPONSES
    // ==========================================
    else if (cmd == "REQ_TLM") {
        Serial.println("TLM_MSG,Simulating Telemetry SD Downlink...");
        // The main loop is already printing TLM_RCV, so we just acknowledge it.
    }
    else if (cmd == "REQ_GSN") {
        Serial.println("TLM_MSG,Simulating GSN SD Downlink...");
        // Simulate reading a GSN file by printing a fake GSN string
        Serial.println("GSN_RCV,20260531_150000,GSN-01,-75,25.1,76.4,40,0,0,7.78,84,8.5");
    }
    else if (cmd == "REQ_IMG_LIST") {
        Serial.println("TLM_MSG,Querying Payload SD for Image Catalog...");
        // Simulate the payload returning a list of available files
        Serial.println("IMG_LIST:IMG_20260531_101500.jpg,IMG_20260531_143000.jpg,IMG_20260531_160000.jpg");
    }
    else if (cmd.startsWith("REQ_IMG:")) {
        String ts = cmd.substring(8);
        Serial.print("TLM_MSG,Simulating Image Download: IMG_");
        Serial.print(ts);
        Serial.println(".jpg");
    }
    
    else {
        Serial.print("TLM_MSG,Command not recognized: ");
        Serial.println(cmd);
    }
}

void setup() {
    Serial.begin(115200);
    randomSeed(analogRead(0));
    passTimer = millis(); 
    
    for (int i = 0; i < MAX_TASKS; i++) {
        taskQueue[i].isPending = false;
    }
}

void loop() {
    // =========================================================
    // A. READ INCOMING UPLINK COMMANDS
    // =========================================================
    if (Serial.available() > 0) {
        String rawCmd = Serial.readStringUntil('\n');
        rawCmd.trim(); 
        
        if (rawCmd.startsWith("IMM:")) {
            String action = rawCmd.substring(4); 
            executeCommand(action);
        } 
        else if (rawCmd.startsWith("SCH:")) {
            int firstColon = 3;
            int secondColon = rawCmd.indexOf(':', firstColon + 1);
            
            if (secondColon != -1) {
                // Keep it as a String!
                String execTimeStr = rawCmd.substring(firstColon + 1, secondColon);
                String action = rawCmd.substring(secondColon + 1);
                
                if (scheduleCommand(execTimeStr, action)) {
                    Serial.print("TLM_MSG,Command Scheduled for TIME: ");
                    Serial.println(execTimeStr);
                } else {
                    Serial.println("TLM_MSG,ERROR: Task Queue Full");
                }
            }
        }
    }

    if (millis() - lastLoopTime >= 1000) {
        lastLoopTime = millis();
        satelliteUnixTime++; // Simulator ticks forward

        // --- NEW: Convert the simulated UNIX time to a Normal Time String ---
        time_t t = satelliteUnixTime;
        struct tm *tm_info = gmtime(&t);
        char timeBuffer[20];
        // Formats the time as "YYYYMMDD_HHMMSS"
        strftime(timeBuffer, sizeof(timeBuffer), "%Y%m%d_%H%M%S", tm_info);
        String currentTimeStr = String(timeBuffer);

        // =========================================================
        // B. PROCESS SCHEDULED COMMANDS
        // =========================================================
        for (int i = 0; i < MAX_TASKS; i++) {
            if (taskQueue[i].isPending) {
                // String alphabetical comparison checks if current time has reached target time
                if (currentTimeStr >= taskQueue[i].executeAt) {
                    executeCommand(taskQueue[i].command);
                    taskQueue[i].isPending = false; 
                }
            }
        }

        // =========================================================
        // C. ORBIT DYNAMICS & FDIR
        // =========================================================
        if (inPass && (millis() - passTimer > PASS_DURATION)) {
            inPass = false; passTimer = millis();
        } else if (!inPass && (millis() - passTimer > LOS_DURATION)) {
            inPass = true; passTimer = millis();
        }

        if (!inPass && random(0, 100) < 5 && payload_state == 0) payload_state = 1; 
        else if (payload_state == 1 && random(0, 100) < 20) payload_state = 0; 

        if (!fdir_override) {
            if (payload_temp > 55.0 || eps_soc < 20.0) payload_state = 0; 
        }

        // --- SD CARD LOGIC ---
        obc_sd_used += 0.001; 
        if (obc_sd_used > 100.0) obc_sd_used = 100.0;
        if (payload_state == 1) {
            payload_sd_used += 0.15; 
            if (payload_sd_used > 100.0) payload_sd_used = 100.0;
        }

        // =========================================================
        // D. POWER & THERMAL SIMULATION
        // =========================================================
        eps_i_in = random(0, 100) > 20 ? random(800, 1200) : 0; 
        if (payload_state == 1) eps_i_payload = random(600, 800); 
        else if (payload_state == 2) eps_i_payload = random(100, 150); 
        else eps_i_payload = 0; 
        
        eps_i_comms = inPass ? random(250, 350) : random(40, 60);
        eps_i_obc = random(140, 160); 
        eps_i_out = eps_i_payload + eps_i_comms + eps_i_obc; 
        
        float net_amps = (eps_i_in - eps_i_out) / 1000.0;
        eps_soc += (net_amps * 0.1); 
        eps_soc = constrain(eps_soc, 0.0, 100.0);
        
        eps_v_bat = 6.0 + ((eps_soc / 100.0) * 2.4) - ((eps_i_out / 1000.0) * 0.15);
        eps_v_3v3 = 3.3 + (random(-2, 2) / 100.0);
        
        // 5V_1 (Payload) drops heavily when taking pictures
        eps_v_5v_1 = payload_state > 0 ? 4.90 + (random(-5, 5) / 100.0) : 5.02;
        
        // 5V_2 (Comms) drops slightly during LoRa transmissions
        eps_v_5v_2 = inPass ? 4.96 + (random(-2, 2) / 100.0) : 5.01;
        
        // 5V_3 (Aux) is always stable
        eps_v_5v_3 = 5.02 + (random(-1, 1) / 100.0);

        obc_temp = 30.0 + (eps_i_out / 200.0) + random(-1, 2); 
        eps_temp = 20.0 + (abs(net_amps) * 5.0);
        payload_temp += (payload_state == 1) ? 1.5 : -2.0;
        payload_temp = constrain(payload_temp, 5.0, 80.0);

        env_pressure = 1013.2 + (random(-5, 5) / 10.0); 
        env_humidity = 12.0 + (random(-2, 2) / 10.0);   
        gps_alt = 405.5 + (random(-10, 10) / 10.0);     

        // =========================================================
        // E. TRANSMIT DOWNLINK CSV
        // =========================================================
        if (inPass) {
            String sat_id = "FG-ALPHA"; 

            // --- 1. TRANSMIT TELEMETRY PACKET ---
            Serial.print("TLM_RCV,");
            Serial.print(sat_id); Serial.print(",");
            Serial.print(currentTimeStr); Serial.print(",");
            Serial.print(fdir_override ? "OVERRIDE" : "AUTO"); Serial.print(",");
            Serial.print(payload_state); Serial.print(",");
            Serial.print(obc_temp); Serial.print(",");
            Serial.print(payload_temp); Serial.print(",");
            Serial.print(rssi_uplink); Serial.print(",");
            Serial.print(eps_soc); Serial.print(",");
            Serial.print(eps_v_bat); Serial.print(",");
            Serial.print(eps_v_3v3); Serial.print(",");
            Serial.print(eps_v_5v_1); Serial.print(","); // Bus 1
            Serial.print(eps_v_5v_2); Serial.print(","); // Bus 2
            Serial.print(eps_v_5v_3); Serial.print(","); // Bus 3
            Serial.print(eps_i_in); Serial.print(",");
            Serial.print(eps_i_out); Serial.print(",");
            Serial.print(eps_i_payload); Serial.print(",");
            Serial.print(eps_i_comms); Serial.print(",");
            Serial.print(eps_temp); Serial.print(",");
            Serial.print(env_pressure); Serial.print(",");
            Serial.print(env_humidity); Serial.print(",");
            Serial.print(gps_alt); Serial.print(",");
            Serial.print(obc_sd_used); Serial.print(",");
            Serial.print(payload_sd_used); Serial.print(",");
            Serial.print(image_resolution); Serial.print(",");

            // Thermal Data Array
            bool fireDetected = random(0, 100) < 15; 
            int firePixel = random(0, 64); 
            for (int i = 0; i < 64; i++) {
                float pixelTemp = fireDetected && i == firePixel ? random(700, 900)/10.0 : random(200, 260)/10.0;
                Serial.print(pixelTemp);
                if (i < 63) Serial.print(",");
            }
            Serial.println(); // End of TLM_RCV Packet

            // --- 2. TRANSMIT GSN PACKET (SEPARATE STREAM) ---
            gsn_sd_used += 0.005; 
            if(gsn_sd_used > 100.0) gsn_sd_used = 100.0;

            // Format: GSN_RCV, TIMESTAMP, NODE_ID, RSSI, TEMP, HUM, SOIL, SMOKE, SOUND, V_BAT, SOC, SD_PCT
            Serial.print("GSN_RCV,");
            Serial.print(currentTimeStr); Serial.print(","); // [1] Timestamp
            Serial.print("GSN-01"); Serial.print(",");       // [2] Node ID
            Serial.print(random(-95, -70)); Serial.print(","); // [3] Node RSSI
            Serial.print(25.1 + (random(-15, 15)/10.0)); Serial.print(","); // [4] Temp
            Serial.print(76.4 + (random(-50, 50)/10.0)); Serial.print(","); // [5] Hum
            Serial.print(40 + random(-5, 5)); Serial.print(","); // [6] Soil
            Serial.print(random(0, 100) < 5 ? 1 : 0); Serial.print(","); // [7] Smoke
            Serial.print(random(0, 100) < 8 ? 1 : 0); Serial.print(","); // [8] Sound
            Serial.print(7.78 - (random(0, 5)/100.0)); Serial.print(","); // [9] V_BAT
            Serial.print(84 - random(0, 2)); Serial.print(",");  // [10] SOC
            Serial.print(gsn_sd_used);                           // [11] SD_PCT
            Serial.println(); // End of GSN_RCV Packet
        }
    }
}