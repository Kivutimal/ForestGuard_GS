import sqlite3
import os
from werkzeug.security import generate_password_hash

DB_FILE = 'forestguard.db'

def init_database():
    print("🚀 Initializing ForestGuard Database...")
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. USERS TABLE (For securing Control Panel and Dashboard)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL
    )
    ''')

    # 2. COMMAND LOG TABLE (Audit trail of every command sent)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        username TEXT NOT NULL,
        command_text TEXT NOT NULL
    )
    ''')

    # 3. TELEMETRY TABLE (Historical data mapping perfectly to our C++/CSV)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        gs_rssi INTEGER,
        fdir_mode TEXT,
        payload_state INTEGER,
        obc_temp REAL,
        payload_temp REAL,
        rssi_uplink INTEGER,
        eps_soc REAL,
        eps_v_bat REAL,
        eps_v_3v3 REAL,
        eps_v_5v_1 REAL,
        eps_v_5v_2 REAL,
        eps_v_5v_3 REAL,
        eps_i_in INTEGER,
        eps_i_out INTEGER,
        eps_i_payload INTEGER,
        eps_i_comms INTEGER,
        eps_temp REAL,
        env_pressure REAL,
        env_humidity REAL,
        gps_alt REAL,
        obc_sd REAL,
        payload_sd REAL,
        image_res INTEGER,
        ir_0 INTEGER,
        ir_1 INTEGER,
        ir_2 INTEGER,
        ir_3 INTEGER,
        ir_4 INTEGER
    )
    ''')

    # 4. GSN TABLE (Historical ground sensor data)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS gsn (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        node_id TEXT NOT NULL,
        rssi INTEGER,
        temp REAL,
        hum REAL,
        soil INTEGER,
        smoke INTEGER,
        sound INTEGER,
        v_bat REAL,
        soc INTEGER,
        sd_used REAL
    )
    ''')
# ==========================================
    # 4.5 ALARMS TABLE (Persistent Event Log)
    # ==========================================
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS alarms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        level TEXT NOT NULL,
        acknowledged INTEGER DEFAULT 0,
        ack_by TEXT,
        ack_time DATETIME
    )
    ''')
    print("✅ Created 'alarms' table.")
    
    # ==========================================
    # 5. INJECT DEFAULT USERS
    # ==========================================
    # ("username", "password", "role")
    users_to_add = [
        # COMMANDERS (Access to Control Panel & Dashboard)
        ("Mal", "Kick_out", "commander"),
        ("Kivuti", "1223334444", "commander"),

        # MONITORS (Access to Dashboard only)
        ("ranger_01", "mau_watch_01", "viewer"),
        ("ranger_02", "mau_watch_02", "viewer"),
        ("analyst",   "data_team_26", "viewer"),
        ("guest",     "public_view",  "viewer")
    ]

    for username, plain_password, role in users_to_add:
        cursor.execute("SELECT * FROM users WHERE username=?", (username,))
        if cursor.fetchone() is None:
            # Hash the password securely
            hashed_pw = generate_password_hash(plain_password)
            cursor.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", 
                           (username, hashed_pw, role))
            print(f"👤 Added user: '{username}' (Role: {role})")

    conn.commit()
    conn.close()
    print(f"🎉 Database setup complete! Saved to {os.path.abspath(DB_FILE)}")

if __name__ == '__main__':
    init_database()