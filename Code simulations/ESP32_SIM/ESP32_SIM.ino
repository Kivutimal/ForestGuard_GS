unsigned long lastTransmission = 0;
float batteryLevel = 100.0;

void setup() {
  // Start the Serial communication at a fast baud rate
  Serial.begin(115200);
  
  // Create a random seed so our "fake data" changes every time we reboot
  randomSeed(analogRead(0));
}

void loop() {
  // Transmit data every 2000 milliseconds (2 seconds)
  if (millis() - lastTransmission > 2000) {
    lastTransmission = millis();

    // --- 1. SIMULATE HOUSEKEEPING TELEMETRY ---
    // Battery slowly drains by 0.1% every tick
    batteryLevel -= 0.1; 
    if (batteryLevel <= 0) batteryLevel = 100.0; // Recharge!
    
    // Signal strength fluctuates between -95dBm (weak) and -65dBm (strong)
    int rssi = random(-95, -65); 
    
    // System temperature (15.0°C to 25.0°C)
    float sysTemp = random(150, 250) / 10.0; 

    // --- 2. SIMULATE AMG8833 THERMAL SENSOR (8x8 Grid = 64 pixels) ---
    // Let's create a 15% chance that a "Forest Fire" breaks out!
    bool fireDetected = random(0, 100) < 15; 
    int firePixel = random(0, 64); // Pick a random spot for the fire

    // --- 3. PACKAGE & SEND THE DATA (JSON Format) ---
    Serial.print("{");
    Serial.print("\"type\":\"TELEMETRY\",");
    Serial.print("\"battery\":"); Serial.print(batteryLevel); Serial.print(",");
    Serial.print("\"rssi\":"); Serial.print(rssi); Serial.print(",");
    Serial.print("\"sysTemp\":"); Serial.print(sysTemp); Serial.print(",");
    
    // Create the 64-value thermal array
    Serial.print("\"thermal\":[");
    for (int i = 0; i < 64; i++) {
      // Normal forest ground temp is 20.0°C to 26.0°C
      float pixelTemp = random(200, 260) / 10.0; 
      
      // If there's a fire and this is the fire pixel, spike the heat!
      if (fireDetected && i == firePixel) {
        pixelTemp = random(700, 900) / 10.0; // 70.0°C to 90.0°C (FIRE!)
      }
      
      Serial.print(pixelTemp);
      if (i < 63) Serial.print(","); // Add comma between numbers
    }
    Serial.print("]");
    Serial.println("}"); // End the JSON string with a newline
  }
}