const socket = typeof io !== 'undefined' ? io() : null;
// ==============================================================================
// 1. CLOCK & MAP INITIALIZATION
// ==============================================================================
function updateClock() {
    const el = document.getElementById('mission-clock');
    if (el) {
        const t = new Date().toLocaleTimeString('en-GB', { 
            timeZone: 'Africa/Nairobi', 
            hour12: false 
        });
        el.innerText = `EAT: ${t}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

const mapElement = document.getElementById('map-container');
let satelliteMarker, orbitPath, map, gsnMarker;

if (mapElement) {
    map = L.map('map-container').setView([0, 0], 3);
    
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { 
        pane: 'shadowPane' 
    }).addTo(map);

    const satIcon = L.divIcon({
        html: '<div style="font-size:24px; filter:drop-shadow(0 0 10px #66fcf1);">🛰️</div>',
        className: 'satellite-icon', 
        iconSize:[30, 30]
    });

    satelliteMarker = L.marker([0, 0], { 
        icon: satIcon 
    }).addTo(map);
    
    satelliteMarker.bindPopup('<b>ForestGuard Alpha</b>');
    
    orbitPath = L.polyline([], { 
        color: '#66fcf1', 
        weight: 2, 
        opacity: 0.6 
    }).addTo(map);
    
    // Fixed marker for Ground Sensor Network in MAU FOREST, KENYA
    const gsnIcon = L.divIcon({
        html: '<div id="gsn-map-icon" style="font-size:18px; filter:drop-shadow(0 0 8px #00ff00);">🌳</div>',
        className: 'gsn-icon',
        iconSize: [24, 24]
    });
    
    // Mau Forest Coordinates
    gsnMarker = L.marker([-0.2325, 35.5523], { icon: gsnIcon }).addTo(map);
    gsnMarker.bindPopup('<b>Ground Sensor Network</b><br>Node: GSN-01<br>Location: Mau Forest');
}


// ==============================================================================
// 2. TELEMETRY CHART & DROPDOWN LOGIC
// ==============================================================================

// Dataset mappings (Now excluding Attitude, tracking GPS alt/env directly)
const chartMappings = {
    rssi: {
        "All RSSI Networks": { indices: [0, 1, 2], unit: "dBm" },
        "GS RSSI Only": { indices: [0], unit: "dBm" },
        "Uplink RSSI Only": { indices: [1], unit: "dBm" },
        "GSN RSSI Only": { indices: [2], unit: "dBm" }
    },
    temp: {
        "All Temperatures": { indices: [3, 4, 5], unit: "°C" },
        "OBC Temp": { indices: [3], unit: "°C" },
        "Payload Temp": { indices: [4], unit: "°C" },
        "Battery Temp": { indices: [5], unit: "°C" }
    },
    eps_power: {
        "Power Flow (Gen vs Total Draw)": { indices: [7, 8], unit: "mA" },
        "Battery SoC (%)": { indices: [6], unit: "%" },
        "Battery Voltage (V)": { indices: [9], unit: "V" }
    },
    currents: {
        "All Subsystem Currents": { indices: [10, 11, 12], unit: "mA" },
        "Payload Draw Only": { indices: [10], unit: "mA" },
        "Comms Draw Only": { indices: [11], unit: "mA" },
        "OBC/Base Draw Only": { indices: [12], unit: "mA" },
        "Total Combined Draw": { indices: [8], unit: "mA" }
    },
    env: {
        "Internal Pressure": { indices: [13], unit: "hPa" },
        "Internal Humidity": { indices: [14], unit: "%" },
        "GPS Altitude": { indices: [15], unit: "km" }
    }
};

let latestTelemetryCache = {
    0: "--", 1: "--", 2: "--", 3: "--", 4: "--",
    5: "--", 6: "--", 7: "--", 8: "--", 9: "--",
    10: "--", 11: "--", 12: "--", 13: "--", 14: "--",
    15: "--"
};

const chartElement = document.getElementById('chart-container');
if (chartElement) {
    const ctx = document.createElement('canvas');
    chartElement.appendChild(ctx);
    
    window.signalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels:[],
            datasets:[
                // 0-2: RSSI
                { label: 'GS RSSI', data: [], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false, pointRadius: 1 },
                { label: 'Up RSSI', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false, pointRadius: 1 },
                { label: 'GSN RSSI', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false, pointRadius: 1 },
                
                // 3-5: Temperatures
                { label: 'OBC Temp', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Payload Temp', data:[], borderColor: '#e74c3c', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Bat Temp', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                
                // 6-9: EPS Power
                { label: 'Battery SoC', data:[], borderColor: '#00ff00', backgroundColor: 'rgba(0,255,0,0.1)', fill: true, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Solar Gen', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Total Draw', data:[], borderColor: '#e74c3c', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Bat Voltage', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                
                // 10-12: Subsystem Currents
                { label: 'Payload Draw', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Comms Draw', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'OBC Draw', data:[], borderColor: '#c5c6c7', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                
                // 13-15: Environment & GPS Altitude
                { label: 'Pressure', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Humidity', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Altitude', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 }
            ]
        },
        options: { 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } } 
        }
    });
}

window.updateChartDropdowns = function() {
    const group = document.getElementById('chart-group').value;
    const metricSelect = document.getElementById('chart-metric');
    
    metricSelect.innerHTML = '';
    
    for (const key in chartMappings[group]) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.innerText = key;
        metricSelect.appendChild(opt);
    }
    
    window.updateChartVisibility();
};

window.updateChartVisibility = function() {
    if (!window.signalChart) return;
    
    const group = document.getElementById('chart-group').value;
    const metricName = document.getElementById('chart-metric').value;
    
    const selectedIndices = chartMappings[group][metricName].indices;
    
    window.signalChart.data.datasets.forEach((ds, i) => {
        ds.hidden = !selectedIndices.includes(i);
    });
    
    window.signalChart.update();
    updateLiveTextValueDisplay(group, metricName);
};

function updateLiveTextValueDisplay(group, metricName) {
    const displayEl = document.getElementById('chart-live-value');
    if (!displayEl) return;
    
    const mapData = chartMappings[group][metricName];
    const indices = mapData.indices;
    const unit = mapData.unit;
    
    if (indices.length === 1) {
        const idx = indices[0];
        const label = window.signalChart.data.datasets[idx].label;
        const color = window.signalChart.data.datasets[idx].borderColor;
        const val = latestTelemetryCache[idx];
        
        displayEl.innerHTML = `<span style="color:${color}">${label}: ${val} ${unit}</span>`;
    } else {
        let htmlParts =[];
        indices.forEach(idx => {
            const label = window.signalChart.data.datasets[idx].label;
            const color = window.signalChart.data.datasets[idx].borderColor;
            const val = latestTelemetryCache[idx];
            htmlParts.push(`<span style="color:${color}">${label}: ${val}</span>`);
        });
        displayEl.innerHTML = htmlParts.join(' <span style="color:#5a7080">|</span> ') + ` <span style="font-size:0.8em; color:#8a9ba8;">(${unit})</span>`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById('chart-group')) {
        window.updateChartDropdowns();
    }
    if (document.getElementById('thermal-grid')) {
        loadThermal('normal');
    }
});


// ==============================================================================
// 3. WEBSOCKET & FDIR TRACKING
// ==============================================================================
let passWatchdog = null; 

function triggerEPSPulse() {
    document.querySelectorAll('.dynamic-value').forEach(el => {
        el.classList.remove('pulse-update');
        void el.offsetWidth; 
        el.classList.add('pulse-update');
    });
}

function checkEPSAnomalies(eps, obc_temp, payload_temp, fdir_mode, payload_state, env, timestampStr) {
    const statusBadge = document.getElementById('system-status-badge');
    let hasAlert = false;

    // FDIR & Temperatures
    if (fdir_mode === 'AUTO' && payload_state === 0 && (payload_temp > 50 || eps.soc < 20)) {
        pushToEventStack(timestampStr, 'FDIR', 'OBC autonomously commanded Payload OFF.', 'WARNING');
        hasAlert = true;
    }
    if (payload_temp > 50) {
        pushToEventStack(timestampStr, 'THERMAL', `Payload Temp approaching limits (${payload_temp.toFixed(1)}°C).`, 'WARNING');
        hasAlert = true;
    }

    // EPS Power & Buses
    if (eps.soc <= 20) {
        pushToEventStack(timestampStr, 'EPS', `Battery SoC Critical (${eps.soc}%). Load Shedding recommended.`, 'CRITICAL');
        hasAlert = true;
    }
    if (eps.v_3v3 < 3.0) {
        pushToEventStack(timestampStr, 'EPS', `3.3V Reg Bus unstable (${eps.v_3v3.toFixed(2)}V). Brownout risk.`, 'CRITICAL');
        hasAlert = true;
    }
    // ---> NEW: Checking all three 5V buses! <---
    if (eps.v_5v_1 < 4.5 && payload_state === 1) {
        pushToEventStack(timestampStr, 'EPS', `5V_1 Payload Bus voltage sag (${eps.v_5v_1.toFixed(2)}V).`, 'WARNING');
        hasAlert = true;
    }
    if (eps.v_5v_2 < 4.5) {
        pushToEventStack(timestampStr, 'EPS', `5V_2 Comms Bus degraded (${eps.v_5v_2.toFixed(2)}V).`, 'CRITICAL');
        hasAlert = true;
    }
    if (eps.v_5v_3 < 4.5) {
        pushToEventStack(timestampStr, 'EPS', `5V_3 Aux Bus degraded (${eps.v_5v_3.toFixed(2)}V).`, 'WARNING');
        hasAlert = true;
    }

    // Environment
    if (env && env.pressure < 800) {
        pushToEventStack(timestampStr, 'ENV', 'Internal pressure dropping. Integrity compromise possible.', 'CRITICAL');
        hasAlert = true;
    }
    if (env && env.humidity > 40) {
        pushToEventStack(timestampStr, 'ENV', 'High internal humidity. Condensation risk to electronics.', 'WARNING');
        hasAlert = true;
    }

    // Update Status Badge
    if (statusBadge) {
        if (hasAlert) {
            statusBadge.className = 'badge danger-alert'; 
            statusBadge.innerText = '❌ System: ALERTS ACTIVE';
        } else {
            // Only set nominal if the GSN isn't also throwing errors
            statusBadge.className = 'badge nominal'; 
            statusBadge.innerText = '✅ System: NOMINAL'; 
        }
    }
}

function checkGSNAnomalies(gsn) {
    if (!gsn) return;
    const timeStr = String(gsn.timestamp).replace("_", " ");
    let hasAlert = false;

    if (gsn.smoke === 1) {
        pushToEventStack(timeStr, 'GSN', `Node ${gsn.node_id} detected active SMOKE!`, 'CRITICAL');
        hasAlert = true;
    }
    if (gsn.sound === 1) {
        pushToEventStack(timeStr, 'GSN', `Node ${gsn.node_id} detected chainsaw acoustics!`, 'WARNING');
        hasAlert = true;
    }
    if (gsn.soc < 15) {
        pushToEventStack(timeStr, 'GSN', `Node ${gsn.node_id} battery critically low (${gsn.soc}%).`, 'WARNING');
        hasAlert = true;
    }

    // Make sure the main status badge reflects GSN errors too
    const statusBadge = document.getElementById('system-status-badge');
    if (hasAlert && statusBadge) {
        statusBadge.className = 'badge danger-alert'; 
        statusBadge.innerText = '❌ System: ALERTS ACTIVE';
    }
}
// ==============================================================================
// DATABASE-BACKED LATCHING ALARM STACK
// ==============================================================================

function pushToEventStack(timestamp, source, message, level) {
    // Instead of drawing it immediately, send it to Python to be saved in the database!
    if (socket && socket.connected) {
        socket.emit('trigger_alarm', {
            timestamp: timestamp,
            source: source,
            message: message,
            level: level
        });
    }
}

// Draw the HTML Card when Python confirms it is in the database
function renderAlarmCard(alarm) {
    const stack = document.getElementById('event-log-stack');
    if (!stack) return;

    // Prevent drawing duplicates if it already exists on screen
    if (document.getElementById(`alarm-card-${alarm.id}`)) return;

    let bgColor = alarm.level === 'CRITICAL' ? 'rgba(231,76,60,0.15)' : 'rgba(241,196,15,0.15)';
    let borderColor = alarm.level === 'CRITICAL' ? '#e74c3c' : '#f1c40f';

    const card = document.createElement('div');
    card.id = `alarm-card-${alarm.id}`;
    card.style.background = bgColor;
    card.style.borderLeft = `4px solid ${borderColor}`;
    card.style.padding = '10px';
    card.style.borderRadius = '4px';
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    card.style.fontSize = '0.85rem';

    card.innerHTML = `
        <div>
            <span style="color:#8a9ba8; font-family:'Courier New', monospace; margin-right:10px;">[${alarm.timestamp}]</span>
            <strong style="color:${borderColor}; margin-right:5px;">${alarm.source}:</strong> 
            <span style="color:white;">${alarm.message}</span>
        </div>
        <button class="cmd-btn" style="padding:2px 8px; font-size:0.7rem; border-color:${borderColor}; color:${borderColor};" onclick="ackAlarm(${alarm.id})">Ack</button>
    `;

    stack.prepend(card);
}

// When the user clicks 'Ack'
window.ackAlarm = function(id) {
    if (socket && socket.connected) {
        socket.emit('acknowledge_alarm', { id: id });
    }
};

if (socket) {
    // Listen for new alarms broadcasted from Python
    socket.on('new_alarm_broadcast', (alarm) => {
        renderAlarmCard(alarm);
    });

    // Listen for removal broadcasts (if you or someone else clicks Ack)
    socket.on('remove_alarm_broadcast', (data) => {
        const card = document.getElementById(`alarm-card-${data.id}`);
        if (card) {
            card.style.opacity = '0.5';
            setTimeout(() => card.remove(), 300); // Small fade effect
        }
    });
}

// --- NEW: FETCH ALARMS ON PAGE LOAD SO THEY SURVIVE REFRESHES ---
document.addEventListener("DOMContentLoaded", async () => {
    // ... your other DOMContentLoaded logic ...
    
    // Fetch un-acked alarms from the database
    if (document.getElementById('event-log-stack')) {
        try {
            const res = await fetch('/api/active_alarms');
            const alarms = await res.json();
            // Render them in reverse so the newest is at the top
            alarms.reverse().forEach(a => renderAlarmCard(a));
        } catch (e) {
            console.log("No active alarms fetched.");
        }
    }
});

if (socket) {
    socket.on('telemetry_update', (data) => {
        
        // --- 1. ALWAYS RUN PASS WATCHDOG ---
        const passBadge = document.getElementById('pass-status-badge');
        if(passBadge) {
            passBadge.className = 'badge nominal';
            passBadge.innerText = '📡 AOS (In Pass)';
            passBadge.style.background = 'rgba(0,255,0,0.1)';
            passBadge.style.borderColor = 'var(--success-green)';
            passBadge.style.color = 'white';
            
            clearTimeout(passWatchdog);
            passWatchdog = setTimeout(() => {
                passBadge.className = 'badge danger-alert';
                passBadge.innerText = '📡 LOS (Out of Range)';
                passBadge.style.background = 'rgba(241,196,15,0.1)';
                passBadge.style.borderColor = '#f1c40f';
                passBadge.style.color = '#f1c40f';
                
                const plBadge = document.getElementById('badge-payload-state');
                if (plBadge) {
                    plBadge.innerText = '📸 Payload: OFF';
                    plBadge.style.color = '#c5c6c7';
                }
            }, 3000);
        }

        // ========================================================
        // ROUTE A: SATELLITE TELEMETRY PACKET
        // ========================================================
        if (data.type === 'TELEMETRY') {
            const satTimeString = String(data.timestamp).replace("_", " ");

            // --- Badges ---
            const fdirBadge = document.getElementById('badge-fdir-mode');
            if (fdirBadge) {
                fdirBadge.innerText = data.fdir_mode === 'OVERRIDE' ? '🤖 FDIR: OVERRIDE' : '🤖 FDIR: AUTO';
                fdirBadge.style.color = data.fdir_mode === 'OVERRIDE' ? '#f1c40f' : '#66fcf1'; 
                fdirBadge.style.borderColor = data.fdir_mode === 'OVERRIDE' ? '#f1c40f' : '#66fcf1';
            }
            const resBadge = document.getElementById('badge-resolution');
            if (resBadge && data.resolution !== undefined) {
                resBadge.innerText = `📐 Res: ${data.resolution}p`;
                if (data.resolution <= 480) resBadge.style.color = '#f1c40f'; 
                else if (data.resolution >= 2160) resBadge.style.color = '#e74c3c'; 
                else resBadge.style.color = '#66fcf1'; 
            }
            const plBadge = document.getElementById('badge-payload-state');
            if (plBadge) {
                if (data.payload_state === 1) {
                    plBadge.innerText = '📸 Payload: IMAGING'; plBadge.style.color = '#f1c40f';
                } else if (data.payload_state === 2) {
                    plBadge.innerText = '📡 Payload: DOWNLINKING'; plBadge.style.color = '#66fcf1';
                } else {
                    plBadge.innerText = '💤 Payload: IDLE/OFF'; plBadge.style.color = '#c5c6c7';
                }
            }

            // --- Cache & EPS ---
            latestTelemetryCache[0] = data.rssi_gs;
            latestTelemetryCache[1] = data.rssi_uplink;
            latestTelemetryCache[3] = data.obc_temp.toFixed(1);
            latestTelemetryCache[4] = data.payload_temp.toFixed(1);

            if (data.eps) {
                let i_payload = data.eps.i_payload !== undefined ? data.eps.i_payload : 0;
                let i_comms = data.eps.i_comms !== undefined ? data.eps.i_comms : 0;
                let i_obc = Math.max(0, data.eps.i_out - i_payload - i_comms);
                
                latestTelemetryCache[5] = data.eps.temp.toFixed(1);
                latestTelemetryCache[6] = data.eps.soc.toFixed(1);
                latestTelemetryCache[7] = data.eps.i_in;
                latestTelemetryCache[8] = data.eps.i_out;
                latestTelemetryCache[9] = data.eps.v_bat.toFixed(2);
                latestTelemetryCache[10] = i_payload;
                latestTelemetryCache[11] = i_comms;
                latestTelemetryCache[12] = i_obc;

                document.getElementById('val-eps-soc').innerText = data.eps.soc.toFixed(1) + '%';
                document.getElementById('val-eps-iin').innerText = data.eps.i_in + ' mA';
                document.getElementById('val-eps-iout').innerText = data.eps.i_out + ' mA';
                document.getElementById('val-eps-vbat').innerText = data.eps.v_bat.toFixed(2) + ' V';
                document.getElementById('val-eps-3v3').innerText = data.eps.v_3v3.toFixed(2) + ' V';
                
                // --- NEW: Three 5V Buses ---
                const v5v1El = document.getElementById('val-eps-5v1');
                const v5v2El = document.getElementById('val-eps-5v2');
                const v5v3El = document.getElementById('val-eps-5v3');
                
                if (v5v1El) v5v1El.innerText = data.eps.v_5v_1 !== undefined ? data.eps.v_5v_1.toFixed(2) + ' V' : '-- V';
                if (v5v2El) v5v2El.innerText = data.eps.v_5v_2 !== undefined ? data.eps.v_5v_2.toFixed(2) + ' V' : '-- V';
                if (v5v3El) v5v3El.innerText = data.eps.v_5v_3 !== undefined ? data.eps.v_5v_3.toFixed(2) + ' V' : '-- V';
                document.getElementById('val-eps-ipayload').innerText = i_payload + ' mA';
                document.getElementById('val-eps-icomms').innerText = i_comms + ' mA';
                document.getElementById('val-eps-iobc').innerText = i_obc + ' mA';

                const net = data.eps.i_in - data.eps.i_out;
                const stateEl = document.getElementById('val-eps-state');
                if (stateEl) {
                    if (net > 0) {
                        stateEl.innerHTML = `🔋 CHARGING (+${net} mA)`; stateEl.style.color = 'var(--success-green)';
                    } else if (net < 0) {
                        stateEl.innerHTML = `⚠️ DISCHARGING (${net} mA)`; stateEl.style.color = 'var(--danger-red)';
                    } else {
                        stateEl.innerHTML = `⚖️ BALANCED (0 mA)`; stateEl.style.color = '#f1c40f';
                    }
                }
            }

            if (data.env) {
                latestTelemetryCache[13] = data.env.pressure.toFixed(1);
                latestTelemetryCache[14] = data.env.humidity.toFixed(1);
                document.getElementById('val-env-press').innerText = data.env.pressure.toFixed(1) + ' hPa';
                document.getElementById('val-env-hum').innerText = data.env.humidity.toFixed(1) + ' %';
            }
            if (data.gps) {
                latestTelemetryCache[15] = data.gps.alt.toFixed(1);
                document.getElementById('val-gps-alt').innerText = data.gps.alt.toFixed(1) + ' km';
            }
            if (data.lat && data.lng) {
                document.getElementById('val-gps-lat').innerText = data.lat.toFixed(4) + '°';
                document.getElementById('val-gps-lng').innerText = data.lng.toFixed(4) + '°';
                
                if (satelliteMarker) {
                    const pos =[data.lat, data.lng];
                    satelliteMarker.setLatLng(pos);
                    orbitPath.addLatLng(pos);
                    map.panTo(pos, { animate: true, duration: 1.0 });
                }
            }
            if (data.sd) {
                const sdObcEl = document.getElementById('val-sd-obc');
                const sdPayEl = document.getElementById('val-sd-pay');
                if (sdObcEl) {
                    sdObcEl.innerText = data.sd.obc.toFixed(1) + '%';
                    sdObcEl.style.color = data.sd.obc > 85 ? 'var(--danger-red)' : '#66fcf1';
                }
                if (sdPayEl) {
                    sdPayEl.innerText = data.sd.payload.toFixed(1) + '%';
                    sdPayEl.style.color = data.sd.payload > 85 ? 'var(--danger-red)' : '#66fcf1';
                }
            }

            checkEPSAnomalies(data.eps, data.obc_temp, data.payload_temp, data.fdir_mode, data.payload_state, data.env, satTimeString);
            triggerEPSPulse();

            // --- CHART PUSH (ONLY during Telemetry updates to prevent zigzag lines) ---
            if (window.signalChart) {
                window.signalChart.data.labels.push(satTimeString);
                window.signalChart.data.datasets[0].data.push(data.rssi_gs);
                window.signalChart.data.datasets[1].data.push(data.rssi_uplink);
                // Pull GSN RSSI from the cache
                window.signalChart.data.datasets[2].data.push(latestTelemetryCache[2] !== "--" ? latestTelemetryCache[2] : 0); 
                window.signalChart.data.datasets[3].data.push(data.obc_temp);
                window.signalChart.data.datasets[4].data.push(data.payload_temp);
                window.signalChart.data.datasets[5].data.push(data.eps ? data.eps.temp : 0);
                window.signalChart.data.datasets[6].data.push(data.eps ? data.eps.soc : 0);
                window.signalChart.data.datasets[7].data.push(data.eps ? data.eps.i_in : 0);
                window.signalChart.data.datasets[8].data.push(data.eps ? data.eps.i_out : 0);
                window.signalChart.data.datasets[9].data.push(data.eps ? data.eps.v_bat : 0);
                
                let i_p = data.eps && data.eps.i_payload !== undefined ? data.eps.i_payload : 0;
                let i_c = data.eps && data.eps.i_comms !== undefined ? data.eps.i_comms : 0;
                let i_o = data.eps ? Math.max(0, data.eps.i_out - i_p - i_c) : 0;
                
                window.signalChart.data.datasets[10].data.push(i_p);
                window.signalChart.data.datasets[11].data.push(i_c);
                window.signalChart.data.datasets[12].data.push(i_o);
                window.signalChart.data.datasets[13].data.push(data.env ? data.env.pressure : 0);
                window.signalChart.data.datasets[14].data.push(data.env ? data.env.humidity : 0);
                window.signalChart.data.datasets[15].data.push(data.gps ? data.gps.alt : 0);

                if (window.signalChart.data.labels.length > 20) {
                    window.signalChart.data.labels.shift();
                    window.signalChart.data.datasets.forEach(ds => ds.data.shift());
                }
                window.signalChart.update();
            }

            if (data.ir_zones) {
                updateIRSensorUI(data.ir_zones, data.payload_state);
            }
        }
        
        // ========================================================
        // ROUTE B: GROUND SENSOR NETWORK PACKET
        // ========================================================
        else if (data.type === 'GSN_UPDATE') {
            if (data.gsn) {
                // Update Cache so the Chart picks it up on the next tick
                latestTelemetryCache[2] = data.gsn.rssi;

                const gTimeEl = document.getElementById('val-gsn-time');
                if (gTimeEl && data.gsn.timestamp) {
                    gTimeEl.innerText = "Recorded: " + String(data.gsn.timestamp).replace("_", " ");
                }

                document.getElementById('val-gsn-node').innerText = `NODE: ${data.gsn.node_id}`;
                
                const gSmoke = document.getElementById('val-gsn-smoke');
                gSmoke.innerText = data.gsn.smoke === 1 ? "DETECTED" : "CLEAR";
                gSmoke.style.color = data.gsn.smoke === 1 ? "var(--danger-red)" : "var(--success-green)";
                
                const gSound = document.getElementById('val-gsn-sound');
                gSound.innerText = data.gsn.sound === 1 ? "DETECTED" : "CLEAR";
                gSound.style.color = data.gsn.sound === 1 ? "#f1c40f" : "var(--success-green)";
                
                document.getElementById('val-gsn-soil').innerText = data.gsn.soil + '%';
                document.getElementById('val-gsn-temp').innerText = data.gsn.temp.toFixed(1) + '°C';
                document.getElementById('val-gsn-hum').innerText = data.gsn.hum.toFixed(1) + '%';
                
                const gBat = document.getElementById('val-gsn-bat');
                gBat.innerText = data.gsn.soc + '%';
                gBat.style.color = data.gsn.soc > 20 ? "var(--success-green)" : "var(--danger-red)";

                const sdGsnEl = document.getElementById('val-sd-gsn');
                if (sdGsnEl && data.gsn.sd !== undefined) {
                    sdGsnEl.innerText = data.gsn.sd.toFixed(1) + '%';
                    sdGsnEl.style.color = data.gsn.sd > 85 ? 'var(--danger-red)' : '#66fcf1';
                }

                const gsnIconDiv = document.getElementById('gsn-map-icon');
                if (gsnIconDiv) {
                    if (data.gsn.smoke === 1 || data.gsn.sound === 1) {
                        gsnIconDiv.style.filter = 'drop-shadow(0 0 15px #e74c3c)';
                        gsnIconDiv.innerText = '🔥';
                    } else {
                        gsnIconDiv.style.filter = 'drop-shadow(0 0 8px #00ff00)';
                        gsnIconDiv.innerText = '🌳';
                    }
                }

                checkGSNAnomalies(data.gsn);
            }
        }

        // Live text label logic applies to both types
        const group = document.getElementById('chart-group')?.value;
        const metricName = document.getElementById('chart-metric')?.value;
        if(group && metricName) updateLiveTextValueDisplay(group, metricName);
    });
}

// ==============================================================================
// 5. PAYLOAD ANALYZER — SAMPLE LOADING
// ==============================================================================
const SAMPLE_LABELS = {
    'forest_healthy.jpg': '🌳 Healthy forest',
    'forest_deforested.jpg': '❌ Deforested area',
    'forest_burn.jpg': '🔥 Burn scar',
    'forest_rainforest.jpg': '🌿 Dense rainforest',
    'forest_stressed.jpg': '⚠️ Drought stressed',
};

async function loadSamples() {
    const ids =['sample-select', 'before-select', 'after-select'];
    const sels = ids.map(id => document.getElementById(id)).filter(Boolean);
    
    if (!sels.length) return;
    
    try {
        const res = await fetch('/api/samples');
        const files = await res.json();
        
        sels.forEach(sel => {
            sel.innerHTML = '<option value="">-- select image --</option>';
            files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.innerText = SAMPLE_LABELS[f] || f;
                sel.appendChild(opt);
            });
        });
        
        ['before-select', 'after-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', checkCompareReady);
            }
        });
        
    } catch (e) {
        sels.forEach(sel => {
            sel.innerHTML = '<option value="">⚠️ Backend offline</option>';
        });
    }
}

// ==============================================================================
// 6. RGB TAB — IMAGE PREVIEW
// ==============================================================================
function previewSample() {
    const sel = document.getElementById('sample-select');
    const box = document.getElementById('rgb-preview-box');
    const img = document.getElementById('rgb-img');
    const canvas = document.getElementById('rgb-canvas');
    const btn = document.getElementById('analyze-btn');
    
    if (!sel || !box) return;

    img.style.display = 'none';
    canvas.style.display = 'none';
    
    document.getElementById('rgb-legend').style.display = 'none';
    document.getElementById('rgb-results').style.display = 'none';
    
    btn.disabled = true;

    const ph = box.querySelector('.loading-text');
    if (ph) {
        ph.style.display = sel.value ? 'none' : 'block';
    }
    
    if (!sel.value) return;

    img.onload = () => { 
        img.style.display = 'block'; 
        btn.disabled = false; 
        canvas.width = img.naturalWidth; 
        canvas.height = img.naturalHeight; 
    };
    
    img.src = '/samples/' + sel.value;
}

// ==============================================================================
// 7. RGB TAB — OPENCV ANALYSIS
// ==============================================================================
async function runRGBAnalysis() {
    const sel = document.getElementById('sample-select');
    if (!sel || !sel.value) return;
    
    const btn = document.getElementById('analyze-btn');
    const loading = document.getElementById('analyze-loading');
    
    btn.disabled = true; 
    loading.style.display = 'flex'; 
    document.getElementById('rgb-results').style.display = 'none';

    try {
        const res = await fetch('/api/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ filename: sel.value }) 
        });
        
        const data = await res.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        renderRGBResults(data); 
        drawRegions(data);
        
    } catch (e) {
        alert('Analysis error: ' + e.message);
    } finally {
        btn.disabled = false; 
        loading.style.display = 'none';
    }
}

function renderRGBResults(data) {
    let scoreColor;
    if (data.health_score >= 70) {
        scoreColor = 'var(--success-green)';
    } else if (data.health_score >= 40) {
        scoreColor = '#f1c40f';
    } else {
        scoreColor = '#e74c3c';
    }
                     
    document.getElementById('r-score').innerText = data.health_score; 
    document.getElementById('r-score').style.color = scoreColor;
    document.getElementById('r-grade').innerText = 'GRADE ' + data.health_grade;
    document.getElementById('r-ndvi').innerText = data.ndvi_proxy.toFixed(2);
    document.getElementById('r-edge').innerText = 'edges: ' + data.edge_density + '%';

    setBar('bar-veg', 'val-veg', data.vegetation_pct); 
    setBar('bar-bare', 'val-bare', data.bare_pct); 
    setBar('bar-burn', 'val-burn', data.burn_pct);
    
    setRiskBadge('badge-fire', data.fire_risk); 
    setRiskBadge('badge-defor', data.deforestation_risk);

    const allZones =[];
    if (data.bare_regions) {
        allZones.push(...data.bare_regions);
    }
    if (data.burn_regions) {
        allZones.push(...data.burn_regions);
    }
    
    const zoneWrap = document.getElementById('zone-list-wrap');
    const zoneList = document.getElementById('zone-list');
    
    if (allZones.length > 0) {
        zoneList.innerHTML = allZones.map((z, i) => {
            const confClass = z.confidence >= 80 ? 'conf-high' : 'conf-med';
            let aoiHtml = '';
            if (z.lat && z.lng) {
                aoiHtml = `<div style="font-size:0.8rem; color:#66fcf1; margin-top:6px; font-family:'Courier New', monospace; letter-spacing:1px; background:rgba(0,0,0,0.4); padding:4px 8px; border-radius:4px;">
                            📍 AOI: Lat ${z.lat}, Lng ${z.lng}
                           </div>`;
            }

            return `
            <div class="zone-item" style="height:auto; flex-direction:column; align-items:flex-start; padding:10px;">
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                    <span><span class="zone-num">${i + 1}</span> <span class="zone-label">${z.label}</span></span>
                    <span class="zone-area">${z.area_pct}% area</span>
                    <span class="zone-conf ${confClass}">${z.confidence}% Conf</span>
                </div>
                ${aoiHtml}
            </div>`;
        }).join('');
        zoneWrap.style.display = 'block';
    } else { 
        zoneWrap.style.display = 'none'; 
    }

    const roadWrap = document.getElementById('road-list-wrap');
    const roadAlert = document.getElementById('road-alert');
    const roadList = document.getElementById('road-list');
    const roads = data.road_segments ||[];
    
    document.getElementById('r-road-count').innerText = data.road_count || 0; 
    document.getElementById('r-road-coverage').innerText = (data.road_coverage_pct || 0) + '%';
    
    if (data.road_count > 0) {
        roadList.innerHTML = roads.slice(0, 6).map((s, i) => {
            const confClass = s.confidence >= 80 ? 'conf-high' : 'conf-med';
            return `
            <div class="zone-item">
                <span class="zone-num" style="background:rgba(0,200,255,0.15); color:#00ccff;">${i + 1}</span>
                <span class="zone-label">Track segment ${i + 1}</span>
                <span class="zone-area">${s.length_pct.toFixed(1)}% len</span>
                <span class="zone-conf ${confClass}">${s.confidence}% Conf</span>
            </div>`;
        }).join('');
        
        roadWrap.style.display = 'block'; 
        
        if (data.road_count >= 4) {
            roadAlert.style.display = 'block';
        } else {
            roadAlert.style.display = 'none';
        }
    } else { 
        roadWrap.style.display = 'none'; 
    }
    
    document.getElementById('rgb-results').style.display = 'block';
}

// ==============================================================================
// 8. RGB TAB — CANVAS OVERLAY
// ==============================================================================
function drawRegions(data) {
    const img = document.getElementById('rgb-img');
    const canvas = document.getElementById('rgb-canvas');
    if (!img || !canvas) return;
    
    canvas.width = img.naturalWidth; 
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    
    ctx.clearRect(0, 0, W, H);

    function drawBox(region, color, label) {
        const x = region.x * W;
        const y = region.y * H;
        const w = region.w * W;
        const h = region.h * H;
        
        ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.12)'); 
        ctx.fillRect(x, y, w, h);
        
        ctx.strokeStyle = color; 
        ctx.lineWidth = Math.max(2, W * 0.003); 
        ctx.strokeRect(x, y, w, h);
        
        const fullLabel = `${label} (${region.confidence}%)`;
        const fs = Math.max(11, W * 0.018); 
        ctx.font = `bold ${fs}px monospace`;
        
        const tw = ctx.measureText(fullLabel).width + 10;
        
        ctx.fillStyle = color; 
        ctx.fillRect(x, y - fs - 6, tw, fs + 6); 
        ctx.fillStyle = '#000'; 
        ctx.fillText(fullLabel, x + 5, y - 3);
    }

    if (data.bare_regions) {
        data.bare_regions.forEach((r, i) => drawBox(r, 'rgb(241,196,15)', `Zone ${i + 1}: Cleared`));
    }
    
    if (data.burn_regions) {
        data.burn_regions.forEach((r, i) => drawBox(r, 'rgb(231,76,60)', `Zone ${i + 1}: Burn`));
    }
    
    if (data.road_segments) {
        data.road_segments.forEach((seg, i) => {
            const x1 = seg.x1 * W;
            const y1 = seg.y1 * H;
            const x2 = seg.x2 * W;
            const y2 = seg.y2 * H;
            
            ctx.strokeStyle = 'rgba(0,200,255,0.85)'; 
            ctx.lineWidth = Math.max(2, W * 0.004); 
            ctx.lineCap = 'round'; 
            
            ctx.beginPath(); 
            ctx.moveTo(x1, y1); 
            ctx.lineTo(x2, y2); 
            ctx.stroke();
            
            if (i < 4) {
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const fs = Math.max(10, W * 0.016); 
                
                ctx.font = `bold ${fs}px monospace`;
                const label = `Track ${i + 1} (${seg.confidence}%)`;
                const tw = ctx.measureText(label).width + 8;
                
                ctx.fillStyle = 'rgba(0,200,255,0.9)'; 
                ctx.fillRect(mx - tw / 2, my - fs - 4, tw, fs + 6); 
                ctx.fillStyle = '#000'; 
                ctx.fillText(label, mx - tw / 2 + 4, my - 2);
            }
        });
    }
    
    let hasContent = false;
    if (data.bare_regions && data.bare_regions.length > 0) hasContent = true;
    if (data.burn_regions && data.burn_regions.length > 0) hasContent = true;
    if (data.road_segments && data.road_segments.length > 0) hasContent = true;
    
    canvas.style.display = hasContent ? 'block' : 'none'; 
    document.getElementById('rgb-legend').style.display = hasContent ? 'flex' : 'none';
}

// ==============================================================================
// 9. IR DETECTOR TAB (5-CHANNEL SWIR)
// ==============================================================================

function updateIRSensorUI(ir_array, payload_state) {
    if (!ir_array || ir_array.length !== 5) return;

    const alarmBox = document.getElementById('ir-fire-alarm');
    const angleText = document.getElementById('ir-fire-angle');
    const stowedMsg = document.getElementById('ir-stowed-msg');
    const statusBadge = document.getElementById('ir-status-badge');
    const interpText = document.getElementById('ir-interp');

    // Power budget logic: If payload is OFF, sensor is stowed.
    if (payload_state === 0) {
        alarmBox.style.display = 'none';
        stowedMsg.style.display = 'block';
        stowedMsg.innerText = "Sensor is STOWED. Will activate when Payload powers ON.";
        
        statusBadge.className = 'risk-badge risk-low';
        statusBadge.innerText = 'POWER OFF';
        interpText.innerText = 'To conserve the EPS power budget, the SWIR array remains offline until the next scheduled AOI pass.';
        
        // Dim the boxes
        for (let i = 0; i < 5; i++) {
            const box = document.getElementById(`ir-zone-${i}`);
            if(box) {
                box.style.borderColor = '#333';
                box.style.color = '#555';
                box.style.background = 'rgba(0,0,0,0.4)';
                box.style.boxShadow = 'none';
            }
        }
        return;
    }

    // Payload is ON! Let's check for 1s and 0s
    stowedMsg.style.display = 'none';
    let fireAngles = [];
    const labels = ["L-60°", "L-30°", "NADIR (CENTER)", "R-30°", "R-60°"];

    for (let i = 0; i < 5; i++) {
        const box = document.getElementById(`ir-zone-${i}`);
        if (!box) continue;

        if (ir_array[i] === 1) {
            // FIRE DETECTED in this zone!
            box.style.borderColor = '#e74c3c';
            box.style.color = '#fff';
            box.style.background = 'rgba(231,76,60,0.8)';
            box.style.boxShadow = '0 0 15px rgba(231,76,60,0.6)';
            fireAngles.push(labels[i]);
        } else {
            // Nominal zone
            box.style.borderColor = '#66fcf1';
            box.style.color = '#66fcf1';
            box.style.background = 'rgba(0,0,0,0.4)';
            box.style.boxShadow = 'none';
        }
    }

    if (fireAngles.length > 0) {
        alarmBox.style.display = 'block';
        angleText.innerText = fireAngles.join(" & ");
        
        statusBadge.className = 'risk-badge risk-critical';
        statusBadge.innerText = 'ACTIVE ALARM';
        interpText.innerHTML = `<strong>CRITICAL:</strong> High IR intensity detected in zones: ${fireAngles.join(", ")}. Initiating simultaneous high-resolution RGB capture to confirm anomaly.`;
    } else {
        alarmBox.style.display = 'none';
        statusBadge.className = 'risk-badge risk-medium';
        statusBadge.innerText = 'SCANNING (CLEAR)';
        interpText.innerText = 'Payload is active. SWIR array is returning nominal baseline values. No thermal anomalies detected in the current swath.';
    }
}

// ==============================================================================
// 10. CHANGE DETECTION TAB
// ==============================================================================
function previewChange(which) {
    const sel = document.getElementById(which + '-select');
    const img = document.getElementById(which + '-img');
    
    if (!sel || !img || !sel.value) return;
    
    img.src = '/samples/' + sel.value; 
    img.style.display = 'block';
    
    const ph = document.getElementById(which + '-preview-box').querySelector('.loading-text'); 
    if (ph) {
        ph.style.display = 'none';
    }
    
    checkCompareReady();
}

function checkCompareReady() {
    const b = document.getElementById('before-select');
    const a = document.getElementById('after-select');
    const btn = document.getElementById('compare-btn');
    
    if (btn) {
        btn.disabled = !(b && a && b.value && a.value);
    }
}

async function runChangeDetect() {
    const before = document.getElementById('before-select').value;
    const after = document.getElementById('after-select').value;
    
    if (!before || !after) return;
    
    const btn = document.getElementById('compare-btn');
    const loading = document.getElementById('compare-loading');
    
    btn.disabled = true; 
    loading.style.display = 'flex'; 
    document.getElementById('change-results').style.display = 'none';
    
    try {
        const res = await fetch('/api/compare', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ before, after }) 
        });
        
        const data = await res.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        renderChangeResults(data); 
        drawChangeRegions(data);
        
    } catch (e) { 
        alert('Compare error: ' + e.message); 
    } finally { 
        btn.disabled = false; 
        loading.style.display = 'none'; 
    }
}

function renderChangeResults(data) {
    document.getElementById('ch-change').innerText = data.change_pct + '%'; 
    document.getElementById('ch-regions').innerText = data.change_regions;
    
    const dEl = document.getElementById('ch-veg-delta'); 
    dEl.innerText = (data.veg_delta >= 0 ? '+' : '') + data.veg_delta + '%'; 
    
    if (data.veg_delta >= 0) {
        dEl.style.color = 'var(--success-green)';
    } else {
        dEl.style.color = '#e74c3c';
    }
    
    setBar('bar-veg-b', 'val-veg-b', data.veg_before); 
    setBar('bar-veg-a', 'val-veg-a', data.veg_after);
    
    const defor = data.veg_delta < -10 || data.bare_delta > 10;
    const flagEl = document.getElementById('ch-defor-flag');
    
    if (defor) {
        flagEl.innerText = '⚠️ YES — Vegetation loss detected';
        flagEl.style.color = '#e74c3c';
    } else {
        flagEl.innerText = '✓ Not detected';
        flagEl.style.color = 'var(--success-green)';
    }
    
    const bEl = document.getElementById('ch-bare-delta'); 
    bEl.innerText = (data.bare_delta >= 0 ? '+' : '') + data.bare_delta + '%'; 
    
    if (data.bare_delta > 5) {
        bEl.style.color = '#e74c3c';
    } else {
        bEl.style.color = '#f1c40f';
    }
    
    document.getElementById('change-results').style.display = 'block';
}

function drawChangeRegions(data) {
    const img = document.getElementById('after-img');
    const canvas = document.getElementById('after-canvas');
    if (!img || !canvas) return;
    
    canvas.width = img.naturalWidth || img.width; 
    canvas.height = img.naturalHeight || img.height;
    
    const ctx = canvas.getContext('2d'); 
    ctx.clearRect(0, 0, canvas.width, canvas.height); 
    
    const W = canvas.width;
    const H = canvas.height;
    
    function drawBox(region, color, label) {
        const x = region.x * W;
        const y = region.y * H;
        const w = region.w * W;
        const h = region.h * H;
        
        ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ', 0.15)'); 
        ctx.fillRect(x, y, w, h);
        
        ctx.strokeStyle = color; 
        ctx.lineWidth = Math.max(2, W * 0.003); 
        ctx.strokeRect(x, y, w, h);
        
        const fs = Math.max(11, W * 0.018); 
        ctx.font = `bold ${fs}px monospace`; 
        
        const tw = ctx.measureText(label).width + 8;
        
        ctx.fillStyle = color; 
        ctx.fillRect(x, y - fs - 4, tw, fs + 6); 
        ctx.fillStyle = '#000'; 
        ctx.fillText(label, x + 5, y - 2);
    }
    
    if (data.new_bare_regions) {
        data.new_bare_regions.forEach((r, i) => drawBox(r, 'rgb(231,76,60)', `New clearing ${i + 1}`));
    }
    
    if (data.change_boxes) {
        data.change_boxes.forEach((r, i) => drawBox(r, 'rgb(243,156,18)', `Change ${i + 1}`));
    }
    
    let hasRegions = false;
    if (data.new_bare_regions && data.new_bare_regions.length > 0) hasRegions = true;
    if (data.change_boxes && data.change_boxes.length > 0) hasRegions = true;
    
    canvas.style.display = hasRegions ? 'block' : 'none'; 
    document.getElementById('change-legend').style.display = hasRegions ? 'flex' : 'none';
}

function switchPayloadTab(tab) {
    document.getElementById('payload-rgb').style.display = tab === 'rgb' ? 'block' : 'none';
    document.getElementById('payload-thermal').style.display = tab === 'thermal' ? 'block' : 'none';
    document.getElementById('payload-change').style.display = tab === 'change' ? 'block' : 'none';
    
    const tabs = ['rgb', 'thermal', 'change'];
    document.querySelectorAll('.payload-tabs .chart-btn').forEach((btn, i) => { 
        btn.classList.toggle('active', tabs[i] === tab); 
    });
}

function setBar(barId, valId, pct) {
    const b = document.getElementById(barId);
    const v = document.getElementById(valId);
    
    if (b) {
        b.style.width = Math.min(100, pct) + '%';
    }
    if (v) {
        v.innerText = pct + '%';
    }
}

function setRiskBadge(id, level) {
    const el = document.getElementById(id); 
    if (!el) return;
    el.className = 'risk-badge risk-' + level; 
    el.innerText = level.toUpperCase();
}

// ────────────────────────────────────────────────────────────
// 11. CONTROL PANEL - COMMAND UPLINK & TERMINAL LOGIC
// ────────────────────────────────────────────────────────────

window.sendCommand = function(cmdString) {
    if (socket && socket.connected) {
        socket.emit('send_command', { cmd: cmdString });
    } else {
        alert("Cannot send command: Disconnected from Ground Station server.");
    }
};

window.sendManualCommand = function() {
    const inputEl = document.getElementById('manual-cmd');
    if (inputEl && inputEl.value.trim() !== '') {
        sendCommand(inputEl.value.trim());
        inputEl.value = ''; 
    }
};

// ==============================================================================
// 11.5 EVENT LISTENERS (Control Panel Buttons)
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Manual Terminal Input ---
    const manualInput = document.getElementById('manual-cmd');
    if (manualInput) {
        manualInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendManualCommand();
        });
    }

    // --- 2. Subsystem Health Checks ---
    document.getElementById('btn-ping-obc')?.addEventListener('click', () => {
        sendCommand('IMM:OBC:PING');
    });
    
    document.getElementById('btn-ping-payload')?.addEventListener('click', () => {
        sendCommand('IMM:PAYLOAD:PING');
    });

    document.getElementById('btn-fdir-auto')?.addEventListener('click', () => {
        sendCommand('IMM:FDIR:AUTO');
    });

    document.getElementById('btn-fdir-override')?.addEventListener('click', () => {
        sendCommand('IMM:FDIR:OVERRIDE');
    });

    document.getElementById('btn-res-apply')?.addEventListener('click', () => {
        const resVal = document.getElementById('resolution-select').value;
        sendCommand('IMM:RES:' + resVal);
    });

    // --- 3. Subsystem Data Retrieval ---
    document.getElementById('btn-req-tlm')?.addEventListener('click', () => {
        sendCommand('IMM:REQ_TLM');
    });

    document.getElementById('btn-req-gsn')?.addEventListener('click', () => {
        sendCommand('IMM:REQ_GSN');
    });

    document.getElementById('btn-req-img-list')?.addEventListener('click', () => {
        sendCommand('IMM:REQ_IMG_LIST');
    });

    document.getElementById('btn-req-img-dl')?.addEventListener('click', () => {
        const inputEl = document.getElementById('img-dl-input');
        const timestamp = inputEl.value.trim();
        
        if (timestamp) { 
            sendCommand('IMM:REQ_IMG:' + timestamp); 
            inputEl.value = ''; // Clear box after sending
        } else { 
            alert('Please enter a timestamp from the catalog first.'); 
        }
    });

});

if (socket) {
    socket.on('terminal_log', (data) => {
        const term = document.getElementById('terminal-log');
        if (!term) return;

        const timeStr = new Date().toLocaleTimeString('en-GB');
        const entry = document.createElement('div');
        entry.style.marginBottom = '4px';

        if (data.type === 'tx') {
            entry.innerHTML = `<span style="color:#5a7080;">[${timeStr}] TX:</span> <span style="color:var(--neon-cyan); font-weight:bold;">${data.msg}</span>`;
        } else if (data.type === 'rx') {
            entry.innerHTML = `<span style="color:#5a7080;">[${timeStr}] RX:</span> <span style="color:#00ff00;">${data.msg}</span>`;
        } else if (data.type === 'error') {
            entry.innerHTML = `<span style="color:#5a7080;">[${timeStr}] ERR:</span> <span style="color:var(--danger-red);">${data.msg}</span>`;
        }

        term.appendChild(entry);
        term.scrollTop = term.scrollHeight; 
    });
}

// ────────────────────────────────────────────────────────────
// 12. CONTROL PANEL - PAYLOAD TASKING (SKYFIELD INTEGRATION)
// ────────────────────────────────────────────────────────────

let nextPassUnix = null;

window.predictNextPass = async function() {
    const timeDisplay = document.getElementById('pass-time-display');
    const unixDisplay = document.getElementById('pass-unix-display');
    const btnSchedule = document.getElementById('btn-schedule');
    const btnPredict = document.getElementById('btn-predict');

    // --- NEW: Grab the values from the input boxes ---
    const latInput = document.getElementById('target-lat')?.value || '-0.2325';
    const lngInput = document.getElementById('target-lng')?.value || '35.5523';

    if (!timeDisplay) return;

    btnPredict.disabled = true;
    btnPredict.innerText = "Calculating...";
    timeDisplay.innerText = "Running orbital math...";
    timeDisplay.style.color = "#f1c40f";

    try {
        // --- NEW: Pass the dynamic coordinates to Python via URL parameters ---
        const res = await fetch(`/api/predict_pass?lat=${latInput}&lng=${lngInput}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        nextPassUnix = data.unix;
        timeDisplay.innerText = data.date;
        timeDisplay.style.color = "var(--success-green)";
        unixDisplay.innerText = data.unix;

        if (btnSchedule) {
            btnSchedule.style.opacity = "1";
            btnSchedule.style.pointerEvents = "auto";
            btnSchedule.innerText = "Schedule Capture"; // Reset text in case used previously
        }

    } catch (e) {
        timeDisplay.innerText = "Calculation Failed";
        timeDisplay.style.color = "var(--danger-red)";
        alert("Skyfield Error: " + e.message);
    } finally {
        btnPredict.disabled = false;
        btnPredict.innerText = "Calculate Orbital Pass";
    }
};

window.schedulePayload = function() {
    if (!nextPassUnix) {
        alert("Calculate pass first!");
        return;
    }

    // Grab the normal time string displayed on the screen
    // Example: "2026-05-31 14:37:00 UTC"
    let timeStr = document.getElementById('pass-time-display').innerText;
    
    // Clean it up to match YYYYMMDD_HHMMSS
    // 1. Remove " UTC"
    // 2. Remove dashes and colons
    // 3. Replace the space with an underscore
    let formattedTime = timeStr.replace(" UTC", "")
                               .replace(/-/g, "")
                               .replace(/:/g, "")
                               .replace(" ", "_"); 
    // Result: "20260531_143700"

    // Construct the Normal Time command
    const taskCmd = `SCH:${formattedTime}:PAYLOAD:CAPTURE,60`;
    sendCommand(taskCmd);
    
    const btnSchedule = document.getElementById('btn-schedule');
    if (btnSchedule) {
        btnSchedule.style.opacity = "0.5";
        btnSchedule.style.pointerEvents = "none";
        btnSchedule.innerText = "Scheduled ✓";
    }
};

// ── Initialization ──
if (document.getElementById('sample-select')) {
    loadSamples();
}
