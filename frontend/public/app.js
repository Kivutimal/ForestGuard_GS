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
        "Sat Downlink RSSI (Local)": { indices: [0], unit: "dBm" },
        "GS Uplink RSSI (Remote)": { indices: [1], unit: "dBm" },
        "GSN Node RSSI (Remote)": { indices: [2], unit: "dBm" }
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
    },
    gsn: {
            "All GSN Node Data": { indices: [16, 17, 18], unit: "Mixed" },
            "Soil Moisture (%)": { indices: [16], unit: "%" },
            "Ambient Temp (°C)": { indices: [17], unit: "°C" },
            "Node Battery (%)": { indices: [18], unit: "%" }
    }
};

let latestTelemetryCache = {
    0: "--", 1: "--", 2: "--", 3: "--", 4: "--",
    5: "--", 6: "--", 7: "--", 8: "--", 9: "--",
    10: "--", 11: "--", 12: "--", 13: "--", 14: "--",
    15: "--", 16: "--", 17: "--", 18: "--"
};

// ==============================================================================
// CHART MODE: LIVE vs HISTORY
// ==============================================================================
window.chartMode = 'live'; // Defaults to live mode

window.setChartMode = function(mode) {
    window.chartMode = mode;
    const btnLive = document.getElementById('btn-mode-live');
    const btnHist = document.getElementById('btn-mode-hist');
    const histControls = document.getElementById('history-controls');
    const groupSelect = document.getElementById('chart-group');

    if (!btnLive || !btnHist) return;

    if (mode === 'live') {
        btnLive.style.background = 'rgba(0,255,0,0.15)';
        btnLive.style.color = 'var(--success-green)';
        btnHist.style.background = 'transparent';
        btnHist.style.color = '#8a9ba8';
        
        if (histControls) histControls.style.display = 'none'; 
        
        // SMART UI: Disable deep metrics that the Live Beacon doesn't transmit
        if (groupSelect) {
            Array.from(groupSelect.options).forEach(opt => {
                opt.disabled = ['currents', 'gsn'].includes(opt.value);
            });
            if (['currents', 'gsn'].includes(groupSelect.value)) {
                groupSelect.value = 'rssi';
                window.updateChartDropdowns();
            }
        }
        
        // Clear chart for the fresh live feed
        if (window.signalChart) {
            window.signalChart.data.labels = [];
            window.signalChart.data.datasets.forEach(ds => ds.data = []);
            window.signalChart.update();
        }

        // --- NEW: WIPE GAUGES CLEAN WHEN RETURNING TO LIVE MODE ---
        // 1. Reset Core Gauges to "--"
        const coreIds = ['val-eps-soc', 'val-eps-vbat', 'val-eps-3v3', 'val-env-press', 'val-gps-alt', 'val-gps-lat', 'val-gps-lng'];
        coreIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = '--';
        });

        // 2. Return deep metrics to STANDBY
        const standbyIds = [
            'val-eps-iin', 'val-eps-iout', 'val-eps-5v1', 'val-eps-5v2', 'val-eps-5v3',
            'val-eps-ipayload', 'val-eps-icomms', 'val-eps-iobc', 'val-env-hum',
            'val-sd-obc', 'val-sd-pay', 'val-sd-gsn'
        ];
        standbyIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span style="font-size:0.75rem; color:#5a7080; letter-spacing:1px; display:block; margin-top:8px;">STANDBY</span>';
        });

        // 3. Return GSN metrics to AWAIT_GSN
        const gsnIds = ['val-gsn-smoke', 'val-gsn-sound', 'val-gsn-soil', 'val-gsn-temp', 'val-gsn-hum', 'val-gsn-bat', 'val-gsn-node'];
        gsnIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === 'val-gsn-node') {
                    el.innerText = 'NODE: --';
                } else {
                    el.innerHTML = '<span style="font-size:0.75rem; color:#5a7080; letter-spacing:1px; display:block; margin-top:8px;">AWAIT_GSN</span>';
                }
            }
        });

        // Clear history cache
        window.lastFetchedTlm = null;
        window.lastFetchedGsn = null;
        
    } else {
        btnHist.style.background = 'rgba(102,252,241,0.15)';
        btnHist.style.color = '#66fcf1';
        btnLive.style.background = 'transparent';
        btnLive.style.color = '#8a9ba8';
        
        if (histControls) histControls.style.display = 'flex'; 
        
        // SMART UI: Unlock all dropdown options for the database history
        if (groupSelect) {
            Array.from(groupSelect.options).forEach(opt => opt.disabled = false);
        }
        
        loadHistoricalData(); 
    }
};

window.loadHistoricalData = async function() {
    if (!window.signalChart) return;
    try {
        let urlTlm = '/api/history/telemetry?limit=100';
        let urlGsn = '/api/history/gsn?limit=100';
        
        // Read the time picker boxes
        const startStr = document.getElementById('hist-start')?.value.trim();
        const endStr = document.getElementById('hist-end')?.value.trim();
        
        // If the operator typed in both dates, attach them to the API request
        if (startStr && endStr) {
            urlTlm += `&start=${startStr}&end=${endStr}`;
            urlGsn += `&start=${startStr}&end=${endStr}`;
        }

        // Fetch BOTH databases simultaneously!
        const [resTlm, resGsn] = await Promise.all([
            fetch(urlTlm),
            fetch(urlGsn)
        ]);
        
        const historyTlm = await resTlm.json();
        const historyGsn = await resGsn.json();

        // --- NEW: Save these to memory so our hover function can read them! ---
        window.lastFetchedTlm = historyTlm;
        window.lastFetchedGsn = historyGsn;

        window.signalChart.data.labels = [];
        window.signalChart.data.datasets.forEach(ds => ds.data = []);

        // Use Telemetry rows as the main timeline, and attach GSN data to the same timestamps
        historyTlm.forEach((row, index) => {
            const timeStr = String(row.timestamp).replace("_", " ");
            window.signalChart.data.labels.push(timeStr);
            
            // 1. Sat Downlink RSSI does NOT exist in the past. Force it to be blank.
            window.signalChart.data.datasets[0].data.push(null);
            
            // 2. Uplink RSSI only exists if it's a real negative measurement (e.g., -85). Otherwise, blank.
            const upRssi = (row.rssi_uplink && row.rssi_uplink < 0) ? row.rssi_uplink : null;
            window.signalChart.data.datasets[1].data.push(upRssi);
            
            // Temperatures
            window.signalChart.data.datasets[3].data.push(row.obc_temp || 0);
            window.signalChart.data.datasets[4].data.push(row.payload_temp || 0);
            window.signalChart.data.datasets[5].data.push(row.eps_temp || 0);
            
            window.signalChart.data.datasets[6].data.push(row.eps_soc || 0);
            window.signalChart.data.datasets[7].data.push(row.eps_i_in || 0);
            window.signalChart.data.datasets[8].data.push(row.eps_i_out || 0);
            window.signalChart.data.datasets[9].data.push(row.eps_v_bat || 0);
            
            window.signalChart.data.datasets[10].data.push(row.eps_i_payload || 0);
            window.signalChart.data.datasets[11].data.push(row.eps_i_comms || 0);
            
            const obcDraw = (row.eps_i_out || 0) - ((row.eps_i_payload || 0) + (row.eps_i_comms || 0));
            window.signalChart.data.datasets[12].data.push(obcDraw > 0 ? obcDraw : 0);
            
            window.signalChart.data.datasets[13].data.push(row.env_pressure || 0);
            window.signalChart.data.datasets[14].data.push(row.env_humidity || 0);
            window.signalChart.data.datasets[15].data.push(row.gps_alt || 0);
            
            // Map the GSN Database row alongside the Telemetry row!
            if (historyGsn[index]) {
                // 3. GSN RSSI only exists if it's a real negative measurement.
                const gsnRssi = (historyGsn[index].rssi && historyGsn[index].rssi < 0) ? historyGsn[index].rssi : null;
                
                window.signalChart.data.datasets[2].data.push(gsnRssi);
                window.signalChart.data.datasets[16].data.push(historyGsn[index].soil || 0);
                window.signalChart.data.datasets[17].data.push(historyGsn[index].temp || 0);
                window.signalChart.data.datasets[18].data.push(historyGsn[index].soc || 0);
            } else {
                window.signalChart.data.datasets[2].data.push(null);
                window.signalChart.data.datasets[16].data.push(null);
                window.signalChart.data.datasets[17].data.push(null);
                window.signalChart.data.datasets[18].data.push(null);
            }
        });

        window.signalChart.update();

        window.signalChart.update();
        
        // ========================================================
        // --- STEP B: GLOBAL UI HYDRATION ---
        // Overwrite the "STANDBY" labels with the historical data!
        // ========================================================
        if (historyTlm.length > 0) {
            const latest = historyTlm[historyTlm.length - 1]; // Grab the newest row in the selected time range
            
            // 1. EPS Data
            if (document.getElementById('val-eps-soc')) document.getElementById('val-eps-soc').innerText = latest.eps_soc.toFixed(1) + '%';
            if (document.getElementById('val-eps-iin')) document.getElementById('val-eps-iin').innerText = latest.eps_i_in + ' mA';
            if (document.getElementById('val-eps-iout')) document.getElementById('val-eps-iout').innerText = latest.eps_i_out + ' mA';
            
            if (document.getElementById('val-eps-vbat')) document.getElementById('val-eps-vbat').innerText = latest.eps_v_bat.toFixed(2) + ' V';
            if (document.getElementById('val-eps-3v3')) document.getElementById('val-eps-3v3').innerText = (latest.eps_v_3v3 || 0).toFixed(2) + ' V';
            if (document.getElementById('val-eps-5v1')) document.getElementById('val-eps-5v1').innerText = (latest.eps_v_5v_1 || 0).toFixed(2) + ' V';
            if (document.getElementById('val-eps-5v2')) document.getElementById('val-eps-5v2').innerText = (latest.eps_v_5v_2 || 0).toFixed(2) + ' V';
            if (document.getElementById('val-eps-5v3')) document.getElementById('val-eps-5v3').innerText = (latest.eps_v_5v_3 || 0).toFixed(2) + ' V';
            
            if (document.getElementById('val-eps-ipayload')) document.getElementById('val-eps-ipayload').innerText = latest.eps_i_payload + ' mA';
            if (document.getElementById('val-eps-icomms')) document.getElementById('val-eps-icomms').innerText = latest.eps_i_comms + ' mA';
            
            const obcDraw = latest.eps_i_out - (latest.eps_i_payload + latest.eps_i_comms);
            if (document.getElementById('val-eps-iobc')) document.getElementById('val-eps-iobc').innerText = (obcDraw > 0 ? obcDraw : 0) + ' mA';

            // 2. Flight Dynamics & Environment
            if (document.getElementById('val-gps-alt')) document.getElementById('val-gps-alt').innerText = latest.gps_alt.toFixed(1) + ' km';
            if (document.getElementById('val-env-press')) document.getElementById('val-env-press').innerText = latest.env_pressure.toFixed(1) + ' hPa';
            if (document.getElementById('val-env-hum')) document.getElementById('val-env-hum').innerText = latest.env_humidity.toFixed(1) + ' %';
            
            // 3. SD Storage Limits
            if (document.getElementById('val-sd-obc')) document.getElementById('val-sd-obc').innerText = (latest.obc_sd || 0).toFixed(1) + '%';
            if (document.getElementById('val-sd-pay')) document.getElementById('val-sd-pay').innerText = (latest.payload_sd || 0).toFixed(1) + '%';
            
            // Mark Lat/Lng so the user knows they aren't live
            if (document.getElementById('val-gps-lat')) document.getElementById('val-gps-lat').innerText = 'HISTORY';
            if (document.getElementById('val-gps-lng')) document.getElementById('val-gps-lng').innerText = 'HISTORY';
        }

        // 4. GSN UI Hydration
        if (historyGsn.length > 0) {
            // Re-use your existing awesome GSN UI updater!
            updateGsnUI(historyGsn[historyGsn.length - 1]);
        }
        // ========================================================
        
        // Force the text to update immediately after drawing the chart
        const currentGroup = document.getElementById('chart-group').value;
        const currentMetric = document.getElementById('chart-metric').value;
        updateLiveTextValueDisplay(currentGroup, currentMetric);
        
    } catch (e) {
        console.error("Failed to fetch historical data from DB:", e);
    }
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
                // Downlink is a normal line, but will ONLY be fed data during Live mode
                { label: 'Sat Downlink RSSI', data: [], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false, pointRadius: 1 },
                
                // Uplink and GSN are isolated events! Drawn as thin vertical impulse bars.
                { type: 'bar', label: 'GS Uplink RSSI', data:[], backgroundColor: 'rgba(0, 255, 0, 0.5)', borderColor: '#00ff00', borderWidth: 1, hidden: false, maxBarThickness: 6 },
                { type: 'bar', label: 'GSN Node RSSI', data:[], backgroundColor: 'rgba(241, 196, 15, 0.5)', borderColor: '#f1c40f', borderWidth: 1, hidden: false, maxBarThickness: 6 },

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
                { label: 'Altitude', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                
                // ---16-18 GSN DATASETS ---
                { label: 'Soil Moisture', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'GSN Temp', data:[], borderColor: '#e74c3c', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 },
                { label: 'Node Battery', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true, pointRadius: 1 }
            ]

        },
        options: { 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, 
            scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } },
            
            // --- NEW: INTERACTIVE SNAPPING (NO MORE BLIND HOVERING) ---
            interaction: {
                mode: 'index',
                intersect: false
            },

            // --- NEW: HOVER TIME MACHINE ---
            onHover: (event, activeElements) => {
                // Only scrub values when we are looking at History Mode!
                if (window.chartMode !== 'history') return; 
                
                if (activeElements && activeElements.length > 0) {
                    const hoveredIndex = activeElements[0].index;
                    updateGaugesFromIndex(hoveredIndex);
                } else {
                    // When the mouse leaves the chart, snap back to the latest snapshot
                    resetGaugesToLatest();
                }
            }
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

window.updateLiveTextValueDisplay = function(group, metricName) {
    const displayEl = document.getElementById('chart-live-value');
    if (!displayEl || !chartMappings[group] || !chartMappings[group][metricName]) return;
    
    const mapData = chartMappings[group][metricName];
    const indices = mapData.indices;
    const unit = mapData.unit;

    // Smart fetcher: reads Cache in Live Mode, but reads the Chart in History Mode!
    const getSafeValue = (idx) => {
        if (window.chartMode === 'history') {
            const dataset = window.signalChart.data.datasets[idx];
            if (dataset && dataset.data.length > 0) {
                let val = dataset.data[dataset.data.length - 1]; // Get latest point from chart
                if (val === null || val === undefined) return "--"; // <-- Safely hides nulls!
                return typeof val === 'number' ? val.toFixed(1) : val;
            }
            return "--";
        } else {
            const val = latestTelemetryCache[idx];
            if (val === null || val === undefined || val === "--") return "--";
            return val;
        }
    };
    
    if (indices.length === 1) {
        const idx = indices[0];
        const label = window.signalChart.data.datasets[idx].label;
        const color = window.signalChart.data.datasets[idx].borderColor;
        const val = getSafeValue(idx);
        
        displayEl.innerHTML = `<span style="color:${color}">${label}: ${val} ${unit}</span>`;
    } else {
        let htmlParts = [];
        indices.forEach(idx => {
            const label = window.signalChart.data.datasets[idx].label;
            const color = window.signalChart.data.datasets[idx].borderColor;
            const val = getSafeValue(idx);
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

// --- NEW: FETCH ALARMS AND GSN ON PAGE LOAD ---
document.addEventListener("DOMContentLoaded", async () => {
    
    // Make deep telemetry gauges say 'STANDBY' instead of looking broken
    const standbyIds = [
        'val-eps-iin', 'val-eps-iout', 'val-eps-5v1', 'val-eps-5v2', 'val-eps-5v3',
        'val-eps-ipayload', 'val-eps-icomms', 'val-eps-iobc', 'val-env-hum',
        'val-sd-obc', 'val-sd-pay', 'val-sd-gsn'
    ];
    standbyIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.innerText.includes('--')) {
            el.innerHTML = '<span style="font-size:0.75rem; color:#5a7080; letter-spacing:1px; display:block; margin-top:8px;">STANDBY</span>';
        }
    });

    // Make ground sensor gauges say 'AWAIT_GSN' 
    const gsnIds = ['val-gsn-smoke', 'val-gsn-sound', 'val-gsn-soil', 'val-gsn-temp', 'val-gsn-hum', 'val-gsn-bat'];
    gsnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.innerText.includes('--')) {
            el.innerHTML = '<span style="font-size:0.75rem; color:#5a7080; letter-spacing:1px; display:block; margin-top:8px;">AWAIT_GSN</span>';
        }
    });
    // ------------------------------------------
    
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

    //NEW: Instantly load last known live data from browser memory
    const cachedBeacon = sessionStorage.getItem('lastBeacon');
    if (cachedBeacon) {
        try { updateLiveBeaconUI(JSON.parse(cachedBeacon)); } catch(e){}
    }
    
    const cachedGsn = sessionStorage.getItem('lastGsn');
    if (cachedGsn) {
        try { updateGsnUI(JSON.parse(cachedGsn)); } catch(e){}
    }

    // 4. NEW: Instantly load last known payload resolution from browser memory
    const cachedRes = sessionStorage.getItem('payloadResolution');
    if (cachedRes) {
        updateResolutionBadge(cachedRes);
    } else {
        updateResolutionBadge('1080P'); // Default on first boot
    }

});

// ==============================================================================
// GSN DEBOUNCE LOGIC (Hides the flicker during file dumps)
// ==============================================================================
let gsnUpdateTimer = null;
let latestGsnData = null;

function updateGsnUI(gsn) {
    if (!gsn) return;
    
    // Update the Cache for charts
    latestTelemetryCache[2] = gsn.rssi;

    const gTimeEl = document.getElementById('val-gsn-time');
    if (gTimeEl && gsn.timestamp) {
        gTimeEl.innerText = "Recorded: " + String(gsn.timestamp).replace("_", " ");
    }

    const gNode = document.getElementById('val-gsn-node');
    if(gNode) gNode.innerText = `NODE: ${gsn.node_id}`;
    
    const gSmoke = document.getElementById('val-gsn-smoke');
    if(gSmoke) {
        gSmoke.innerText = gsn.smoke === 1 ? "DETECTED" : "CLEAR";
        gSmoke.style.color = gsn.smoke === 1 ? "var(--danger-red)" : "var(--success-green)";
    }
    
    const gSound = document.getElementById('val-gsn-sound');
    if(gSound) {
        gSound.innerText = gsn.sound === 1 ? "DETECTED" : "CLEAR";
        gSound.style.color = gsn.sound === 1 ? "#f1c40f" : "var(--success-green)";
    }
    
    const gSoil = document.getElementById('val-gsn-soil');
    if(gSoil) gSoil.innerText = gsn.soil + '%';
    
    const gTemp = document.getElementById('val-gsn-temp');
    if(gTemp) gTemp.innerText = gsn.temp.toFixed(1) + '°C';
    
    const gHum = document.getElementById('val-gsn-hum');
    if(gHum) gHum.innerText = gsn.hum.toFixed(1) + '%';
    
    const gBat = document.getElementById('val-gsn-bat');
    if(gBat) {
        gBat.innerText = gsn.soc + '%';
        gBat.style.color = gsn.soc > 20 ? "var(--success-green)" : "var(--danger-red)";
    }

    const sdGsnEl = document.getElementById('val-sd-gsn');
    if (sdGsnEl && gsn.sd !== undefined) {
        sdGsnEl.innerText = gsn.sd.toFixed(1) + '%';
        sdGsnEl.style.color = gsn.sd > 85 ? 'var(--danger-red)' : '#66fcf1';
    }

    const gsnIconDiv = document.getElementById('gsn-map-icon');
    if (gsnIconDiv) {
        if (gsn.smoke === 1 || gsn.sound === 1) {
            gsnIconDiv.style.filter = 'drop-shadow(0 0 15px #e74c3c)';
            gsnIconDiv.innerText = '🔥';
        } else {
            gsnIconDiv.style.filter = 'drop-shadow(0 0 8px #00ff00)';
            gsnIconDiv.innerText = '🌳';
        }
    }
}

function updateLiveBeaconUI(data) {
    const satTimeString = String(data.timestamp).replace("_", " ");

    // --- Badges ---
    const fdirBadge = document.getElementById('badge-fdir-mode');
    if (fdirBadge) {
        fdirBadge.innerText = data.fdir_mode === 'OVERRIDE' ? '🤖 FDIR: OVERRIDE' : '🤖 FDIR: AUTO';
        fdirBadge.style.color = data.fdir_mode === 'OVERRIDE' ? '#f1c40f' : '#66fcf1'; 
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

    // --- Update Core Live Gauges ---
    if (data.eps) {
        document.getElementById('val-eps-soc').innerText = data.eps.soc.toFixed(1) + '%';
        document.getElementById('val-eps-vbat').innerText = data.eps.v_bat.toFixed(2) + ' V';
        document.getElementById('val-eps-3v3').innerText = data.eps.v_3v3.toFixed(2) + ' V';
    }
    if (data.env) {
        document.getElementById('val-env-press').innerText = data.env.pressure.toFixed(1) + ' hPa';
    }
    if (data.gps) {
        document.getElementById('val-gps-alt').innerText = data.gps.alt.toFixed(1) + ' km';
    }
    if (data.lat && data.lng) {
        document.getElementById('val-gps-lat').innerText = data.lat.toFixed(4) + '°';
        document.getElementById('val-gps-lng').innerText = data.lng.toFixed(4) + '°';
        
        if (satelliteMarker && map && orbitPath) {
            const pos = [data.lat, data.lng];
            satelliteMarker.setLatLng(pos);
            orbitPath.addLatLng(pos);
            map.panTo(pos, { animate: true, duration: 1.0 });
        }
    }
    
    checkEPSAnomalies(data.eps, data.obc_temp, null, data.fdir_mode, data.payload_state, data.env, satTimeString);
}

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
        // ROUTE A: LIVE BEACON (Updates Gauges & Map)
        // ========================================================
        if (data.type === 'LIVE_BEACON') {
            sessionStorage.setItem('lastBeacon', JSON.stringify(data)); 
            
            // 1. Update the cache so the text label reads the live RSSI
            latestTelemetryCache[0] = data.rssi_gs;
            
            // 2. If the user is watching the Live Chart, plot it in real-time!
            if (window.chartMode === 'live' && window.signalChart) {
                const timeStr = new Date().toLocaleTimeString('en-GB'); // Local time for X-axis
                
                window.signalChart.data.labels.push(timeStr);
                window.signalChart.data.datasets[0].data.push(data.rssi_gs);
                
                // Keep the live chart from getting infinitely long (rolling window of 20 points)
                if (window.signalChart.data.labels.length > 20) {
                    window.signalChart.data.labels.shift();
                    window.signalChart.data.datasets[0].data.shift();
                }
                
                window.signalChart.update();
            }

            updateLiveBeaconUI(data); 
        }

        // ========================================================
        // ROUTE B: HISTORICAL TELEMETRY (Dumps to Event Stack only!)
        // ========================================================
        else if (data.type === 'HISTORICAL_TELEMETRY') {
            const satTimeString = String(data.timestamp).replace("_", " ");
            
            // Do NOT update the live gauges! 
            // Only scan this data to see if any alarms happened in the past.
            checkEPSAnomalies(data.eps, data.obc_temp, data.payload_temp, data.fdir_mode, data.payload_state, data.env, satTimeString);
            
            if (data.ir_zones) {
                updateIRSensorUI(data.ir_zones, data.payload_state);
            }
        }
        
        // ========================================================
        // ROUTE B: GROUND SENSOR NETWORK PACKET
        // ========================================================
        else if (data.type === 'GSN_UPDATE') {
            if (data.gsn) {
                checkGSNAnomalies(data.gsn);
                latestGsnData = data.gsn;
                
                sessionStorage.setItem('lastGsn', JSON.stringify(data.gsn)); // <-- Save to memory

                if (gsnUpdateTimer) clearTimeout(gsnUpdateTimer);
                gsnUpdateTimer = setTimeout(() => { updateGsnUI(latestGsnData); }, 200);
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
    const alarmBox = document.getElementById('ir-fire-alarm');
    const angleText = document.getElementById('ir-fire-angle');
    const stowedMsg = document.getElementById('ir-stowed-msg');
    const statusBadge = document.getElementById('ir-status-badge');
    const interpText = document.getElementById('ir-interp');

    // EPS Power Conservation rule: If payload is OFF, the sensor is stowed.
    if (payload_state === 0) {
        if (alarmBox) alarmBox.style.display = 'none';
        if (stowedMsg) {
            stowedMsg.style.display = 'block';
            stowedMsg.innerText = "Sensor is STOWED. Will activate when Payload powers ON.";
        }
        if (statusBadge) {
            statusBadge.className = 'risk-badge risk-low';
            statusBadge.innerText = 'STANDBY';
        }
        if (interpText) {
            interpText.innerText = 'To conserve the EPS power budget, the SWIR array remains offline until the next scheduled AOI pass.';
        }
        
        // Dim all 5 zone boxes
        for (let i = 0; i < 5; i++) {
            const box = document.getElementById(`ir-zone-${i}`);
            if (box) {
                box.style.borderColor = '#333';
                box.style.color = '#555';
                box.style.background = 'rgba(0,0,0,0.4)';
                box.style.boxShadow = 'none';
            }
        }
        return;
    }

    // --- Payload is Powered ON! ---
    if (stowedMsg) stowedMsg.style.display = 'none';

    // If we have no raw IR array telemetry (because we are on a Live Beacon)
    if (!ir_array || ir_array.length !== 5) {
        if (statusBadge) {
            statusBadge.className = 'risk-badge risk-medium';
            statusBadge.innerText = 'READY / SCANNING';
        }
        if (interpText) {
            interpText.innerText = 'Payload is active. Baseline SWIR array is warmed up and ready. Awaiting scheduled pass transmission...';
        }
        // Wake up the boxes to a sleek standby cyan state
        for (let i = 0; i < 5; i++) {
            const box = document.getElementById(`ir-zone-${i}`);
            if (box) {
                box.style.borderColor = 'var(--neon-cyan)';
                box.style.color = 'var(--neon-cyan)';
                box.style.background = 'rgba(102,252,241,0.05)';
                box.style.boxShadow = 'none';
            }
        }
        return;
    }

    // If we DO have raw IR array telemetry (from a database history point or a telemetry dump)
    let fireAngles = [];
    const labels = ["L-60°", "L-30°", "NADIR (CENTER)", "R-30°", "R-60°"];

    for (let i = 0; i < 5; i++) {
        const box = document.getElementById(`ir-zone-${i}`);
        if (!box) continue;

        if (ir_array[i] === 1) {
            // Active thermal anomaly detected!
            box.style.borderColor = '#e74c3c';
            box.style.color = '#fff';
            box.style.background = 'rgba(231,76,60,0.8)';
            box.style.boxShadow = '0 0 15px rgba(231,76,60,0.6)';
            fireAngles.push(labels[i]);
        } else {
            // Nominal baseline
            box.style.borderColor = '#66fcf1';
            box.style.color = '#66fcf1';
            box.style.background = 'rgba(0,0,0,0.4)';
            box.style.boxShadow = 'none';
        }
    }

    if (fireAngles.length > 0) {
        if (alarmBox) alarmBox.style.display = 'block';
        if (angleText) angleText.innerText = fireAngles.join(" & ");
        if (statusBadge) {
            statusBadge.className = 'risk-badge risk-critical';
            statusBadge.innerText = 'ACTIVE ALARM';
        }
        if (interpText) {
            interpText.innerHTML = `<strong>CRITICAL:</strong> High IR intensity detected in zones: ${fireAngles.join(", ")}. Initiating simultaneous high-resolution RGB capture to confirm anomaly.`;
        }
    } else {
        if (alarmBox) alarmBox.style.display = 'none';
        if (statusBadge) {
            statusBadge.className = 'risk-badge risk-medium';
            statusBadge.innerText = 'SCANNING (CLEAR)';
        }
        if (interpText) {
            interpText.innerText = 'Payload is active. SWIR array is returning nominal baseline values. No thermal anomalies detected in the current swath.';
        }
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
            
            // --- NEW: Intercept Command Acknowledgments for Resolution ---
            if (data.msg.includes("Payload resolution updated to")) {
                const match = data.msg.match(/updated to (\w+)/);
                if (match && match[1]) {
                    updateResolutionBadge(match[1]);
                }
            }
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

// ==============================================================================
// 13. STICKY TELEMETRY RIBBON TRIGGER (OPTION D)
// ==============================================================================
window.addEventListener('scroll', () => {
    const ribbon = document.getElementById('sticky-telemetry-ribbon');
    const chartPanel = document.getElementById('chart-container');
    
    if (ribbon && chartPanel) {
        const chartRect = chartPanel.getBoundingClientRect();
        
        // If the top of the chart hits the top of the screen (rect.top <= 100px)
        // AND we are actively looking at historical database records
        if (window.chartMode === 'history' && chartRect.top <= 100) {
            ribbon.style.display = 'flex';
        } else {
            ribbon.style.display = 'none';
        }
    }
});

// ==============================================================================
// 14. HOVER WORKSPACE HYDRATION (TIME MACHINE SCRUBBING)
// ==============================================================================
function updateGaugesFromIndex(index) {
    if (!window.lastFetchedTlm || !window.lastFetchedTlm[index]) return;
    
    const latest = window.lastFetchedTlm[index];
    const gsnRow = (window.lastFetchedGsn && window.lastFetchedGsn[index]) ? window.lastFetchedGsn[index] : null;
    
    const formattedTime = String(latest.timestamp).replace("_", " ");

    // --- Update Sticky Ribbon Time ---
    if (document.getElementById('rib-time')) document.getElementById('rib-time').innerText = formattedTime;

    // --- 1. EPS Data (Main page & Sticky Ribbon) ---
    if (document.getElementById('val-eps-soc')) document.getElementById('val-eps-soc').innerText = latest.eps_soc.toFixed(1) + '%';
    if (document.getElementById('rib-eps-soc')) document.getElementById('rib-eps-soc').innerText = latest.eps_soc.toFixed(1) + '%';
    
    if (document.getElementById('val-eps-iin')) document.getElementById('val-eps-iin').innerText = latest.eps_i_in + ' mA';
    if (document.getElementById('val-eps-iout')) document.getElementById('val-eps-iout').innerText = latest.eps_i_out + ' mA';
    if (document.getElementById('rib-eps-iout')) document.getElementById('rib-eps-iout').innerText = latest.eps_i_out + ' mA';
    
    if (document.getElementById('val-eps-vbat')) document.getElementById('val-eps-vbat').innerText = latest.eps_v_bat.toFixed(2) + ' V';
    if (document.getElementById('rib-eps-vbat')) document.getElementById('rib-eps-vbat').innerText = latest.eps_v_bat.toFixed(2) + ' V';
    
    if (document.getElementById('val-eps-3v3')) document.getElementById('val-eps-3v3').innerText = (latest.eps_v_3v3 || 0).toFixed(2) + ' V';
    if (document.getElementById('val-eps-5v1')) document.getElementById('val-eps-5v1').innerText = (latest.eps_v_5v_1 || 0).toFixed(2) + ' V';
    if (document.getElementById('val-eps-5v2')) document.getElementById('val-eps-5v2').innerText = (latest.eps_v_5v_2 || 0).toFixed(2) + ' V';
    if (document.getElementById('val-eps-5v3')) document.getElementById('val-eps-5v3').innerText = (latest.eps_v_5v_3 || 0).toFixed(2) + ' V';
    
    if (document.getElementById('val-eps-ipayload')) document.getElementById('val-eps-ipayload').innerText = latest.eps_i_payload + ' mA';
    if (document.getElementById('val-eps-icomms')) document.getElementById('val-eps-icomms').innerText = latest.eps_i_comms + ' mA';
    
    const obcDraw = latest.eps_i_out - (latest.eps_i_payload + latest.eps_i_comms);
    if (document.getElementById('val-eps-iobc')) document.getElementById('val-eps-iobc').innerText = (obcDraw > 0 ? obcDraw : 0) + ' mA';

    // --- 2. Temperatures (Main page handles these dynamically, Ribbon displays them) ---
    if (document.getElementById('rib-obc-temp')) document.getElementById('rib-obc-temp').innerText = latest.obc_temp.toFixed(1) + '°C';
    if (document.getElementById('rib-pay-temp')) document.getElementById('rib-pay-temp').innerText = latest.payload_temp.toFixed(1) + '°C';

    // --- 3. Flight Dynamics & Environment ---
    if (document.getElementById('val-gps-alt')) document.getElementById('val-gps-alt').innerText = latest.gps_alt.toFixed(1) + ' km';
    if (document.getElementById('val-env-press')) document.getElementById('val-env-press').innerText = latest.env_pressure.toFixed(1) + ' hPa';
    if (document.getElementById('val-env-hum')) document.getElementById('val-env-hum').innerText = latest.env_humidity.toFixed(1) + ' %';
    
    // --- 4. SD Storage Limits ---
    if (document.getElementById('val-sd-obc')) document.getElementById('val-sd-obc').innerText = (latest.obc_sd || 0).toFixed(1) + '%';
    if (document.getElementById('val-sd-pay')) document.getElementById('val-sd-pay').innerText = (latest.payload_sd || 0).toFixed(1) + '%';
    
    // --- 5. GSN UI Hydration (Main page & Sticky Ribbon) ---
    if (gsnRow) {
        updateGsnUI(gsnRow);
        if (document.getElementById('rib-gsn-node')) {
            document.getElementById('rib-gsn-node').innerText = `${gsnRow.node_id} (${gsnRow.rssi !== null ? gsnRow.rssi + ' dBm' : 'NO_SIG'})`;
        }
    } else {
        if (document.getElementById('rib-gsn-node')) document.getElementById('rib-gsn-node').innerText = '--';
    }
}

function resetGaugesToLatest() {
    if (window.lastFetchedTlm && window.lastFetchedTlm.length > 0) {
        updateGaugesFromIndex(window.lastFetchedTlm.length - 1);
    }
}

// ==============================================================================
// 15. PAYLOAD RESOLUTION STATE MACHINE
// ==============================================================================
function updateResolutionBadge(res) {
    const formatted = String(res).toLowerCase().endsWith('p') ? res : res + 'p';
    
    // Save to browser memory unconditionally (so it survives cross-page switches!)
    sessionStorage.setItem('payloadResolution', formatted.toUpperCase());
    
    // Only update the physical screen element if it exists on the current page
    const badge = document.getElementById('badge-resolution');
    if (badge) {
        badge.innerText = `📐 Res: ${formatted}`;
    }
}

// ── Initialization ──
if (document.getElementById('sample-select')) {
    loadSamples();
}
