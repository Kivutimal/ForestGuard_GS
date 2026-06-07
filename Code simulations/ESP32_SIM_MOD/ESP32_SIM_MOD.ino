// ==============================================================================
// FORESTGUARD ALPHA - LEO SATELLITE SIMULATOR (ESP32 OBC)
// Upgraded with: Handshake (Ping to Wake), Watchdog (Silence to Sleep), Beacon/Dump
// ==============================================================================
#include <time.h> 

unsigned long lastLoopTime = 0;
unsigned long satelliteUnixTime = 1780580000; // Simulated start time (June 4, 2026)

// --- NEW: Radio Handshake & Watchdog Variables ---
bool inPass = false;
unsigned long lastContactTime = 0; 
const unsigned long WATCHDOG_TIMEOUT = 180; // 3 minutes of silence = LOS
int beaconCounter = 0;
bool isDownlinking = false; 

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

float obc_sd_used = 12.4;     
float payload_sd_used = 45.1; 
float gsn_sd_used = 8.5;      
int image_resolution = 1080; 

#define MAX_TASKS 5
struct ScheduledTask {
    String executeAt; 
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
    // DATA DUMPS (Simulating SD Card Reads)
    // ==========================================
    else if (cmd == "REQ_TLM") {
        Serial.println("TLM_MSG,Opening Telemetry SD Card...");
        isDownlinking = true; // Pause Live Beacon
        
        // Burst 5 historical rows
        for(int i=5; i>0; i--) {
            time_t past_t = satelliteUnixTime - (i * 30); 
            struct tm *tm_info = gmtime(&past_t);
            char pastTime[20];
            strftime(pastTime, sizeof(pastTime), "%Y%m%d_%H%M%S", tm_info);
            
            // Create a fake intermittent Uplink RSSI (Only ~20% of rows will have a signal)
            String simUplink = (random(0, 10) > 7) ? String(random(-95, -70)) : "";

            // --- Dynamic Telemetry Simulator math ---
            // Simulates realistic slight variations and noise on each historical point
            float sim_obc_temp = 28.0 + (random(-20, 20) / 10.0);
            float sim_pay_temp = (payload_state == 1) ? (45.0 + (random(-10, 10) / 10.0)) : (23.0 + (random(-15, 15) / 10.0));
            float sim_soc = eps_soc - (i * 0.2) + (random(-5, 5) / 10.0); // Simulated minor SOC drift
            sim_soc = constrain(sim_soc, 0.0, 100.0);
            
            float sim_v_bat = 6.0 + ((sim_soc / 100.0) * 2.4) - (random(0, 3) / 10.0);
            float sim_v_3v3 = 3.3 + (random(-2, 2) / 100.0);
            float sim_v_5v1 = (payload_state > 0) ? 4.90 + (random(-5, 5) / 100.0) : 5.02;
            float sim_v_5v2 = 5.01 + (random(-2, 2) / 100.0);
            float sim_v_5v3 = 5.02 + (random(-1, 1) / 100.0);
            
            int sim_i_in = random(800, 1200);
            int sim_i_payload = (payload_state == 1) ? random(600, 800) : 0;
            int sim_i_comms = random(250, 350);
            int sim_i_obc = random(140, 160);
            int sim_i_out = sim_i_payload + sim_i_comms + sim_i_obc;
            
            float sim_bat_temp = 20.0 + (random(-10, 10) / 10.0);
            float sim_press = 1013.2 + (random(-5, 5) / 10.0);
            float sim_hum = 12.0 + (random(-20, 20) / 10.0);
            float sim_alt = 405.5 + (random(-15, 15) / 10.0);

            // Massive TLM_RCV string
            Serial.print("TLM_RCV,FG-ALPHA,"); 
            Serial.print(pastTime);
            Serial.print(","); Serial.print(fdir_override ? "OVERRIDE" : "AUTO");
            Serial.print(","); Serial.print(payload_state);
            Serial.print(","); Serial.print(sim_obc_temp, 1);
            Serial.print(","); Serial.print(sim_pay_temp, 1);
            Serial.print(","); Serial.print(simUplink);
            Serial.print(","); Serial.print(sim_soc, 1);
            Serial.print(","); Serial.print(sim_v_bat, 2);
            Serial.print(","); Serial.print(sim_v_3v3, 2);
            Serial.print(","); Serial.print(sim_v_5v1, 2);
            Serial.print(","); Serial.print(sim_v_5v2, 2);
            Serial.print(","); Serial.print(sim_v_5v3, 2);
            Serial.print(","); Serial.print(sim_i_in);
            Serial.print(","); Serial.print(sim_i_out);
            Serial.print(","); Serial.print(sim_i_payload);
            Serial.print(","); Serial.print(sim_i_comms);
            Serial.print(","); Serial.print(sim_bat_temp, 1);
            Serial.print(","); Serial.print(sim_press, 1);
            Serial.print(","); Serial.print(sim_hum, 1);
            Serial.print(","); Serial.print(sim_alt, 1);
            Serial.print(","); Serial.print(obc_sd_used, 1);
            Serial.print(","); Serial.print(payload_sd_used, 1);
            Serial.print(","); Serial.print(image_resolution);
            Serial.println(",0,0,0,0,0"); // IR zones baseline as 0
            
            delay(100); 
        }
        Serial.println("TLM_MSG,Telemetry SD Downlink Complete");
        isDownlinking = false; // Resume Live Beacon
    }

    else if (cmd == "REQ_GSN") {
        Serial.println("TLM_MSG,Opening GSN SD Card...");
        isDownlinking = true;
        
        for(int i=5; i>0; i--) {
            time_t past_t = satelliteUnixTime - (i * 30); 
            struct tm *tm_info = gmtime(&past_t);
            char pastTime[20];
            strftime(pastTime, sizeof(pastTime), "%Y%m%d_%H%M%S", tm_info);
            
            // Create a fake intermittent GSN RSSI (Only ~30% of rows will have a signal)
            String simGsnRssi = (random(0, 10) > 6) ? String(random(-90, -60)) : "";

            // --- Dynamic GSN Sensor Math ---
            // Simulates slight variations and noise on each GSN point
            float sim_gsn_temp = 24.5 + (random(-15, 15) / 10.0);
            float sim_gsn_hum = 75.0 + (random(-40, 40) / 10.0);
            int sim_gsn_soil = 38 + random(-5, 10);
            int sim_gsn_smoke = (random(0, 100) < 2) ? 1 : 0; // 2% chance of simulated smoke
            int sim_gsn_sound = (random(0, 100) < 8) ? 1 : 0; // 8% chance of simulated chainsaw acoustic trigger
            float sim_gsn_v_bat = 7.6 + (random(0, 60) / 100.0);
            int sim_gsn_soc = 75 + random(-5, 20);
            float sim_gsn_sd = 8.5 + (i * 0.01);

            // Massive GSN_RCV string with dynamic variables
            Serial.print("GSN_RCV,"); Serial.print(pastTime);
            Serial.print(",GSN-01,");
            Serial.print(simGsnRssi); 
            Serial.print(","); Serial.print(sim_gsn_temp, 1);
            Serial.print(","); Serial.print(sim_gsn_hum, 1);
            Serial.print(","); Serial.print(sim_gsn_soil);
            Serial.print(","); Serial.print(sim_gsn_smoke);
            Serial.print(","); Serial.print(sim_gsn_sound);
            Serial.print(","); Serial.print(sim_gsn_v_bat, 2);
            Serial.print(","); Serial.print(sim_gsn_soc);
            Serial.print(","); Serial.println(sim_gsn_sd, 1);
            
            delay(100);
        }
        Serial.println("TLM_MSG,GSN SD Downlink Complete");
        isDownlinking = false;
    }
    else if (cmd == "REQ_IMG_LIST") {
        Serial.println("TLM_MSG,Querying Payload SD for Image Catalog...");
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
    
    for (int i = 0; i < MAX_TASKS; i++) {
        taskQueue[i].isPending = false;
    }
}

void loop() {
    // =========================================================
    // A. READ INCOMING UPLINK COMMANDS (Wakes the Satellite)
    // =========================================================
    if (Serial.available() > 0) {
        String rawCmd = Serial.readStringUntil('\n');
        rawCmd.trim(); 
        
        // --- HANDSHAKE LOGIC ---
        lastContactTime = satelliteUnixTime; // Reset the 3-minute silence watchdog!
        if (!inPass) {
            inPass = true;
            Serial.println("TLM_MSG,AOS Acquired. Waking LoRa TX. Starting Beacon.");
            beaconCounter = 10; // Force an immediate beacon on wake
        }
        
        if (rawCmd.startsWith("IMM:")) {
            String action = rawCmd.substring(4); 
            executeCommand(action);
        } 
        else if (rawCmd.startsWith("SCH:")) {
            int firstColon = 3;
            int secondColon = rawCmd.indexOf(':', firstColon + 1);
            if (secondColon != -1) {
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
        satelliteUnixTime++; 

        time_t t = satelliteUnixTime;
        struct tm *tm_info = gmtime(&t);
        char timeBuffer[20];
        strftime(timeBuffer, sizeof(timeBuffer), "%Y%m%d_%H%M%S", tm_info);
        String currentTimeStr = String(timeBuffer);

        // =========================================================
        // B. CHECK WATCHDOG TIMER (Silence to Sleep)
        // =========================================================
        if (inPass && (satelliteUnixTime - lastContactTime >= WATCHDOG_TIMEOUT)) {
            inPass = false;
            Serial.println("TLM_MSG,LOS. 3 Minutes of Silence. LoRa TX sleeping.");
        }

        // =========================================================
        // C. PROCESS SCHEDULED COMMANDS
        // =========================================================
        for (int i = 0; i < MAX_TASKS; i++) {
            if (taskQueue[i].isPending) {
                if (currentTimeStr >= taskQueue[i].executeAt) {
                    executeCommand(taskQueue[i].command);
                    taskQueue[i].isPending = false; 
                }
            }
        }

        // =========================================================
        // D. SIMULATED CATASTROPHES (For UI Testing)
        // =========================================================
        if (random(0, 100) < 2) {
            int disaster = random(0, 5);
            if (disaster == 0) eps_v_3v3 = 2.8;         
            if (disaster == 1) eps_v_5v_2 = 4.1;        
            if (disaster == 2) env_pressure = 750.0;    
            if (disaster == 3) env_humidity = 65.0;     
            if (disaster == 4) eps_soc = 15.0;          
        }

        if (!fdir_override) {
            if (payload_temp > 55.0 || eps_soc < 20.0) payload_state = 0; 
        }

        obc_sd_used += 0.001; 
        if (obc_sd_used > 100.0) obc_sd_used = 100.0;
        if (payload_state == 1) {
            payload_sd_used += 0.15; 
            if (payload_sd_used > 100.0) payload_sd_used = 100.0;
        }

        // =========================================================
        // E. POWER & THERMAL SIMULATION
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
        eps_v_5v_1 = payload_state > 0 ? 4.90 + (random(-5, 5) / 100.0) : 5.02;
        eps_v_5v_2 = inPass ? 4.96 + (random(-2, 2) / 100.0) : 5.01;
        eps_v_5v_3 = 5.02 + (random(-1, 1) / 100.0);

        obc_temp = 30.0 + (eps_i_out / 200.0) + random(-1, 2); 
        eps_temp = 20.0 + (abs(net_amps) * 5.0);
        payload_temp += (payload_state == 1) ? 1.5 : -2.0;
        payload_temp = constrain(payload_temp, 5.0, 80.0);

        env_pressure = 1013.2 + (random(-5, 5) / 10.0); 
        env_humidity = 12.0 + (random(-2, 2) / 10.0);   
        gps_alt = 405.5 + (random(-10, 10) / 10.0);     

        // =========================================================
        // F. THE LIVE BEACON (BCN_RCV)
        // =========================================================
        beaconCounter++; 
        
        // ONLY broadcast every 10 seconds, ONLY if awake, and ONLY if not dumping files!
        if (inPass && beaconCounter >= 10 && !isDownlinking) {
            beaconCounter = 0; 
            
            // This is tiny! It only has basic health to keep the needles moving.
            Serial.print("BCN_RCV,FG-ALPHA,");
            Serial.print(currentTimeStr); Serial.print(",");
            Serial.print(fdir_override ? "OVERRIDE" : "AUTO"); Serial.print(","); 
            Serial.print(payload_state); Serial.print(",");  
            Serial.print(obc_temp); Serial.print(",");       
            Serial.print(eps_soc); Serial.print(",");        
            Serial.print(eps_v_bat); Serial.print(",");      
            Serial.print(eps_v_3v3); Serial.print(",");      
            Serial.print(env_pressure); Serial.print(",");   
            Serial.print(gps_alt);                           
            Serial.println(); 
        }
    }
}