#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <LoRa.h>
#include <RTClib.h>
#include <DHT.h>
#include <Adafruit_BMP085.h>
#include <TinyGPS++.h>

// ================= PINS =================
#define SDA_PIN 45
#define SCL_PIN 48

#define DHTPIN 14
#define DHTTYPE DHT11

#define SD_CS   42

#define SCK   36
#define MISO  37
#define MOSI  35

#define LORA_CS 10
#define LORA_RST 9
#define LORA_DIO0 8

#define GPS_RX 7
#define GPS_TX 6

#define PAYLOAD_RX 16
#define PAYLOAD_TX 17

#define STORAGE_LIMIT 0.75 
#define SEALEVELPRESSURE_HPA 1013.25

// ================= OBJECTS =================
DHT dht(DHTPIN, DHTTYPE);
Adafruit_BMP085 bmp;
RTC_DS3231 rtc;
TinyGPSPlus tinyGps;

SPIClass spi = SPI;

String sessionFile ="";
int currentSessionBlock = -1;


// ================= DEVICE STATE =================
enum Device { NONE, SD_DEV, LORA_DEV };
Device currentDevice = NONE;

// ================= GPS =================
String gpsLat = "NO_FIX";
String gpsLon = "NO_FIX";
String gpsAlt = "NO_FIX";
int gpsSat = 0;

// ================= TIMERS =================
/* unsigned long lastSensor = 0;
unsigned long lastSD = 0;
unsigned long lastLoRa = 0; */
unsigned long lastSample = 0;
const unsigned long sampleInterval = 20000;

// ================= DATA =================
String telemetryPacket = "";

String latestFilename = "";

// ================= SPI CONTROL =================
void initSD() {
  spi.begin(SCK, MISO, MOSI);

  digitalWrite(LORA_CS, HIGH);
  digitalWrite(SD_CS, LOW);

  if (!SD.begin(SD_CS, spi, 400000)) {
    Serial.println("❌ SD FAIL");
  } else {
    Serial.println("✅ SD OK");
  }

  digitalWrite(SD_CS, HIGH);
}

void initLoRa() {
  spi.begin(SCK, MISO, MOSI);

  digitalWrite(SD_CS, HIGH);
  digitalWrite(LORA_CS, LOW);

  LoRa.setSPI(spi);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(868E6)) {
    Serial.println("❌ LORA FAIL");
  } else {
    Serial.println("✅ LORA OK");
  }
  
  digitalWrite(LORA_CS, HIGH);
}

void useSD() {
  if (currentDevice != SD_DEV) {
    initSD();
    currentDevice = SD_DEV;
  }
}

void useLoRa() {

  if (currentDevice != LORA_DEV) {

    initLoRa();

    currentDevice = LORA_DEV;
  }
  // ALWAYS force RX mode
}


// ========= COMMANDS LISTENING ==========
void checkLoRa() {
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    String cmd = "";

    while (LoRa.available()) {
      cmd += (char)LoRa.read();
    }

    Serial.println("📥 CMD: " + cmd);

    handleCommand(cmd);

  }
}

// ============= REQUESTS ===============
void sendLatestFile() {

  if (latestFilename == "") {
    Serial.println("❌ No latest file");
    return;
  }

  useSD();

  File file = SD.open(latestFilename);

  if (!file) {
    Serial.println("❌ Open failed");
    return;
  }

  Serial.println("📡 Sending: " + latestFilename);

  while (file.available()) {

    useLoRa();

    LoRa.beginPacket();

    int count = 0;

    while (file.available() && count < 180) {
      LoRa.write(file.read());
      count++;
    }

    LoRa.endPacket();

    delay(50);
  }

  file.close();

  useLoRa();

  Serial.println("✅ Transfer complete");
}

void sendRequestedFile(String filename) {

  // Ensure .csv extension exists
  if (!filename.endsWith(".csv")) {
    filename += ".csv";
  }

  // Add root slash if missing
  if (!filename.startsWith("/")) {
    filename = "/" + filename;
  }

  useSD();

  // ===== Check existence =====
  if (!SD.exists(filename)) {

    Serial.println("❌ Missing File: " + filename);

    useLoRa();

    LoRa.beginPacket();
    LoRa.print("MISSING_FILE:");
    LoRa.print(filename);
    LoRa.endPacket();

    return;
  }

  File file = SD.open(filename);

  if (!file) {

    Serial.println("❌ Open failed");

    return;
  }

  Serial.println("📡 Sending File: " + filename);
  int fileSize = file.size();

  int packetPayload = 150;

  int totalPackets = (fileSize / packetPayload);

  if (fileSize % packetPayload != 0) {
    totalPackets++;
  }

  // ===== Tell Ground Station which file =====
  useLoRa();

  LoRa.beginPacket();
  LoRa.print("BEGIN_FILE:");
  LoRa.print(filename);
  LoRa.print(":");
  LoRa.print(totalPackets);
  LoRa.endPacket();

  delay(100);

  // ===== Send file data =====
  int packetNum = 1;

  while (file.available()) {

    String packetData = "";

    int count = 0;

    while (file.available() && count < packetPayload) {

      packetData += (char)file.read();

      count++;
    }

    useLoRa();

    LoRa.beginPacket();

    LoRa.print("PKT:");
    LoRa.print(packetNum);
    LoRa.print("/");
    LoRa.print(totalPackets);
    LoRa.print(":");

    LoRa.print(packetData);

    LoRa.endPacket();

    Serial.println("📦 Packet " +
                   String(packetNum) +
                  "/" +
                  String(totalPackets));

    packetNum++;

    delay(80);
  }
  /* while (file.available()) {

    LoRa.beginPacket();

    int count = 0;

    while (file.available() && count < 180) {

      LoRa.write(file.read());

      count++;
    }

    LoRa.endPacket();

    delay(50);
  }*/

  file.close();

  // ===== End marker =====
  LoRa.beginPacket();
  LoRa.print("END_FILE:");
  LoRa.print(filename);
  LoRa.endPacket();

  Serial.println("✅ Transfer complete");
}

// ========= COMMAND HANDLING ===========
/* void handleCommand(String cmd) {

  if (cmd == "REQ_LATEST") {
    sendLatestFile();
  }

  else if (cmd == "PING") {
    LoRa.beginPacket();
    LoRa.print("ACK");
    LoRa.endPacket();
  }

}*/

void handleCommand(String cmd) {

  // ===== TELEMETRY =====
  if (cmd == "REQ LATEST") {

    sendRequestedFile(latestFilename);
  }
  else if (cmd.startsWith("REQ ")) {

  String requestList = cmd.substring(4);

  Serial.println("📂 Requested: " + requestList);

  // ===== Multiple file support =====
  while (requestList.length() > 0) {

    int commaIndex = requestList.indexOf(',');

    String filename;

    if (commaIndex == -1) {

      filename = requestList;
      requestList = "";

    } else {

      filename = requestList.substring(0, commaIndex);

      requestList = requestList.substring(commaIndex + 1);
    }

    filename.trim();

    if (filename.length() > 0) {

      sendRequestedFile(filename);

      delay(200);
    }
  }
}

  // ===== PING =====
  else if (cmd == "PING") {

    useLoRa();

    LoRa.beginPacket();
    LoRa.print("ACK");
    LoRa.endPacket();
  }

  // ===== PAYLOAD COMMANDS =====
  else if (cmd.startsWith("PAYLOAD:")) {

    String payloadCmd = cmd.substring(8);

    Serial.println("📸 Forwarding to Payload: " + payloadCmd);

    sendPayloadCommand(payloadCmd);

    // Optional ACK to ground
    useLoRa();

    LoRa.beginPacket();
    LoRa.print("PAYLOAD_CMD_SENT");
    LoRa.endPacket();
  }

  else {

    Serial.println("❌ Unknown command");
  }
}

// ================= GPS =================
void readGPS() {
  while (Serial1.available()) {
    tinyGps.encode(Serial1.read());
  }

  if (tinyGps.location.isUpdated()) {
    gpsLat = String(tinyGps.location.lat(), 6);
    gpsLon = String(tinyGps.location.lng(), 6);
    gpsSat = tinyGps.satellites.value();
  }
  if (tinyGps.altitude.isValid()) {
  gpsAlt = String(tinyGps.altitude.meters());
  }
}

void updateSessionFile() {

  DateTime now = rtc.now();

  // Divide hour into 20-minute blocks
  int sessionMinute = (now.minute() / 20) * 20;

  // Unique session identifier
  int newBlock =
      now.day() * 100 +
      now.hour() * 10 +
      (sessionMinute / 20);

  // Only create new file when block changes
  if (newBlock != currentSessionBlock) {

    currentSessionBlock = newBlock;

    char filename[40];

    sprintf(filename,
            "/T_%04d%02d%02d_%02d%02d.csv",
            now.year(),
            now.month(),
            now.day(),
            now.hour(),
            sessionMinute);

    sessionFile = String(filename);

    useSD();

    File f = SD.open(sessionFile, FILE_WRITE);

    if (f) {

      //f.println("TIME,DHT_T,BMP_T,H,P,LAT,LON,SAT");
      f.println("TIME,DHT_T,BMP_T,H,P,BMP_ALT,LAT,LON,GPS_ALT,SD_USED");

      f.close();

      Serial.println("📁 NEW SESSION: " + sessionFile);

    } else {

      Serial.println("❌ SESSION CREATE FAIL");
    }
  }
}

// ================= SESSION FILE =================
/* void createSessionFile() {
  DateTime now = rtc.now();
  sessionFile = "/T" + String(now.hour()) + String(now.minute()) + ".csv";

  useSD();

  File f = SD.open(sessionFile, FILE_WRITE);
  if (f) {
    f.println("TIME,DHT_T,BMP_T,H,P,LAT,LON,SAT");
    f.close();
    Serial.println("📁 Created: " + sessionFile);
  } else {
    Serial.println("❌ File create fail");
  }
}*/

// ================= STORAGE =================
void manageStorage() {
  useSD();

  uint64_t used = SD.usedBytes();
  uint64_t total = SD.totalBytes();
  float usage = (float)used / (float)total;

  if (usage > STORAGE_LIMIT) {
    Serial.print("⚠️ STORAGE: ");
    Serial.print(usage * 100);
    Serial.println("% FULL");
  }
}

// ================= SD LOG =================
void logToSD(String data) {
  useSD();

  File f = SD.open(sessionFile, FILE_APPEND);

  if (f) {
    f.println(data);
    f.close();
    Serial.println("💾 Logged");
  } else {
    Serial.println("❌ Write fail");
  }
}

// ======== SENSORS AND SD CARD ==========
// ======== SENSORS AND SD CARD ==========
void sampleAndStore() {

  // Update/Create correct 20-minute session file
  updateSessionFile();

  // ===== Read Sensors =====
  float h = dht.readHumidity();
  float t1 = dht.readTemperature();
  float t2 = bmp.readTemperature();
  float p = bmp.readPressure();
  float bmpAlt = bmp.readAltitude(SEALEVELPRESSURE_HPA);

  DateTime now = rtc.now();

  // ===== SD Storage Usage =====
  useSD();

  uint64_t used = SD.usedBytes();
  uint64_t total = SD.totalBytes();

  float sdUsed = ((float)used / (float)total) * 100.0;

  // ===== Build CSV Data =====
  String data =
    String(now.timestamp()) +
    "," + String(t1) +
    "," + String(t2) +
    "," + String(h) +
    "," + String(p) +
    "," + String(bmpAlt) +
    "," + gpsLat +
    "," + gpsLon +
    "," + gpsAlt +
    "," + String(sdUsed, 1);

  latestFilename = sessionFile;

  // ===== Save to SD =====
  File f = SD.open(sessionFile, FILE_APPEND);

  if (f) {

    f.println(data);

    f.close();

    Serial.println("💾 Logged → " + sessionFile);

  } else {

    Serial.println("❌ SD WRITE FAIL");
  }

  // ===== Serial Monitor =====
  Serial.println("📡 DATA: " + data);
}
/* void sampleAndStore() {

  float h = dht.readHumidity();
  float t1 = dht.readTemperature();
  float t2 = bmp.readTemperature();
  float p = bmp.readPressure();

  DateTime now = rtc.now();

  char filename[32];
  sprintf(filename, "/T_%04d%02d%02d_%02d%02d%02d.csv",
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());

  latestFilename = String(filename);
  String data =
    String(now.year()) + "-" + String(now.month()) + "-" + String(now.day()) + " " +
    String(now.hour()) + ":" + String(now.minute()) + ":" + String(now.second()) +
    "," + String(t1) +
    "," + String(t2) +
    "," + String(h) +
    "," + String(p) +
    "," + gpsLat +
    "," + gpsLon +
    "," + String(gpsSat);

  useSD();

  File f = SD.open(filename, FILE_WRITE);
  if (f) {
    f.println("TIME,DHT_T,BMP_T,H,P,LAT,LON,SAT");
    f.println(data);
    f.close();
  }

  Serial.println("💾 Saved: " + String(filename));
  Serial.println("📡 DATA: " + data);
} */

/*void sampleAndStore() {

  updateSessionFile();

  float h = dht.readHumidity();
  float t1 = dht.readTemperature();
  float t2 = bmp.readTemperature();
  float p = bmp.readPressure();
  float bmpAlt = bmp.readAltitude(SEALEVELPRESSURE_HPA);

  DateTime now = rtc.now();

  /* String data =
    String(now.year()) + "-" +
    String(now.month()) + "-" +
    String(now.day()) + " " +
    String(now.hour()) + ":" +
    String(now.minute()) + ":" +
    String(now.second()) +

    "," + String(t1) +
    "," + String(t2) +
    "," + String(h) +
    "," + String(p) +
    "," + gpsLat +
    "," + gpsLon +
    "," + String(gpsSat);

  String data =
  String(now.timestamp()) +
  "," + String(t1) +
  "," + String(t2) +
  "," + String(h) +
  "," + String(p) +
  "," + String(bmpAlt) +
  "," + gpsLat +
  "," + gpsLon +
  "," + gpsAlt +
  "," + String(sdUsed, 1);  

  latestFilename = sessionFile;

  useSD();

  File f = SD.open(sessionFile, FILE_APPEND);

  if (f) {

    f.println(data);

    f.close();

    Serial.println("💾 Logged → " + sessionFile);

  } else {

    Serial.println("❌ SD WRITE FAIL");
  }

  Serial.println("📡 DATA: " + data);

  uint64_t used = SD.usedBytes();
  uint64_t total = SD.totalBytes();

  float sdUsed = ((float)used / (float)total) * 100.0;
}*/

// ================= LORA =================
void sendLoRa(String data) {
  useLoRa();

  LoRa.beginPacket();
  LoRa.print(data);
  LoRa.endPacket();

  Serial.println("📡 LoRa sent");
}

void sendPayloadCommand(String cmd) {

  Serial.println("🛰️ PAYLOAD CMD: " + cmd);

  Serial2.println(cmd);
}

void checkPayloadResponses() {

  while (Serial2.available()) {

    String response = Serial2.readStringUntil('\n');
    response.trim();

    if (response.length() > 0) {

      Serial.println("📸 PAYLOAD: " + response);

      // Relay to Ground Station
      useLoRa();

      LoRa.beginPacket();
      LoRa.print("PAYLOAD:");
      LoRa.print(response);
      LoRa.endPacket();
    }
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n🚀 SYSTEM START");

  pinMode(SD_CS, OUTPUT);
  pinMode(LORA_CS, OUTPUT);

  digitalWrite(SD_CS, HIGH);
  digitalWrite(LORA_CS, HIGH);

  Wire.begin(SDA_PIN, SCL_PIN);

  dht.begin();
  bmp.begin();
  rtc.begin();

  Serial1.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  // ===== PAYLOAD SERIAL =====
  Serial2.begin(9600, SERIAL_8N1, PAYLOAD_RX, PAYLOAD_TX);
  Serial.println("✅ Payload UART Ready");

  //rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  spi.begin(SCK, MISO, MOSI);

  initSD();
  initLoRa();

  // createSessionFile();

  Serial.println("✅ ALL SYSTEMS READY");
}

// ================= LOOP =================
void loop() {

  unsigned long nowMillis = millis();

  readGPS();
   // 🔴 ALWAYS FIRST: never miss commands
  checkLoRa();
  checkPayloadResponses();

  // 🟡 sensor scheduling
  if (millis() - lastSample >= sampleInterval) {
    lastSample = millis();
    sampleAndStore();
  }

  // CPU idle = keeps LoRa responsive
}

  /* // ===== SENSOR EVERY 2s =====
  if (nowMillis - lastSensor >= 2000) {
    lastSensor = nowMillis;

    float h = dht.readHumidity();
    float t1 = dht.readTemperature();
    float t2 = bmp.readTemperature();
    float p = bmp.readPressure();

    DateTime now = rtc.now();

    telemetryPacket =
      String(now.hour()) + ":" + String(now.minute()) + ":" + String(now.second()) +
      "," + String(t1) +
      "," + String(t2) +
      "," + String(h) +
      "," + String(p) +
      "," + gpsLat +
      "," + gpsLon +
      "," + String(gpsSat);

    Serial.println("📡 " + telemetryPacket);
  }

  // ===== SD EVERY 10s =====
  if (nowMillis - lastSD >= 10000) {
    lastSD = nowMillis;
    logToSD(telemetryPacket);
    manageStorage();
  }
  if (nowMillis - lastSample >= 20000) {
    lastSample = nowMillis;

    float h = dht.readHumidity();
    float t1 = dht.readTemperature();
    float t2 = bmp.readTemperature();
    float p = bmp.readPressure();

    DateTime now = rtc.now();

    // Build filename: T_YYYYMMDD_HHMMSS.csv
    char filename[32];
    sprintf(filename, "/T_%04d%02d%02d_%02d%02d%02d.csv",
              now.year(), now.month(), now.day(),
              now.hour(), now.minute(), now.second());

    String data =
        String(now.year()) + "-" + String(now.month()) + "-" + String(now.day()) + " " +
        String(now.hour()) + ":" + String(now.minute()) + ":" + String(now.second()) +
        "," + String(t1) +
        "," + String(t2) +
        "," + String(h) +
        "," + String(p) +
        "," + gpsLat +
        "," + gpsLon +
        "," + String(gpsSat);

    useSD();

    File f = SD.open(filename, FILE_WRITE);
    if (f) {
        f.println("TIME,DHT_T,BMP_T,H,P,LAT,LON,SAT");
        f.println(data);
        f.close();
        Serial.println("💾 Saved: " + String(filename));
    } else {
        Serial.println("❌ SD write fail");
    }

    Serial.println("📡 " + data);
    }

  /* // ===== LORA EVERY 60s =====
  if (nowMillis - lastLoRa >= 60000) {
    lastLoRa = nowMillis;
    sendLoRa(telemetryPacket);
  }
}*/