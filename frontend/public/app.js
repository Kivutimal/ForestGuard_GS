const socket = typeof io !== 'undefined' ? io('http://localhost:8000') : null;

// ─────────────────────────────────────────────────────
// 1. CLOCK & MAP
// ─────────────────────────────────────────────────────
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
let satelliteMarker, orbitPath, map;

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
}

// ─────────────────────────────────────────────────────
// 2. TELEMETRY CHART & DROPDOWN LOGIC
// ─────────────────────────────────────────────────────

// UPGRADED: 19 Distinct Datasets managed by 5 Master Categories
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
        "Payload Temp": { indices:[4], unit: "°C" },
        "Battery Temp": { indices: [5], unit: "°C" }
    },
    eps_power: {
        "Power Flow (Gen vs Total Draw)": { indices:[7, 8], unit: "mA" },
        "Battery SoC (%)": { indices: [6], unit: "%" },
        "Battery Voltage (V)": { indices: [9], unit: "V" }
    },
    currents: {
        "All Subsystem Currents": { indices:[10, 11, 12], unit: "mA" },
        "Payload Draw Only": { indices: [10], unit: "mA" },
        "Comms Draw Only": { indices:[11], unit: "mA" },
        "OBC/Base Draw Only": { indices:[12], unit: "mA" },
        "Total Combined Draw": { indices:[8], unit: "mA" }
    },
    attitude: {
        "All Axes (Pitch/Roll/Yaw)": { indices:[13, 14, 15], unit: "°" },
        "Pitch Only": { indices:[13], unit: "°" },
        "Roll Only": { indices: [14], unit: "°" },
        "Yaw Only": { indices: [15], unit: "°" }
    },
    env: {
        "Internal Pressure": { indices: [16], unit: "hPa" },
        "Internal Humidity": { indices: [17], unit: "%" },
        "GPS Altitude": { indices: [18], unit: "km" }
    }
};

let latestTelemetryCache = {
    0: "--", 1: "--", 2: "--", 3: "--", 4: "--",
    5: "--", 6: "--", 7: "--", 8: "--", 9: "--",
    10: "--", 11: "--", 12: "--", 13: "--", 14: "--",
    15: "--", 16: "--", 17: "--", 18: "--"
};

const chartElement = document.getElementById('chart-container');
if (chartElement) {
    const ctx = document.createElement('canvas');
    chartElement.appendChild(ctx);
    
    window.signalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets:[
                // 0-2: RSSI
                { label: 'GS RSSI', data: [], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false },
                { label: 'Up RSSI', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false },
                { label: 'GSN RSSI', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: false },
                
                // 3-5: Temperatures
                { label: 'OBC Temp', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Payload Temp', data:[], borderColor: '#e74c3c', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Bat Temp', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                
                // 6-9: EPS Power
                { label: 'Battery SoC', data:[], borderColor: '#00ff00', backgroundColor: 'rgba(0,255,0,0.1)', fill: true, tension: 0.4, hidden: true },
                { label: 'Solar Gen', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Total Draw', data:[], borderColor: '#e74c3c', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Bat Voltage', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                
                // 10-12: Subsystem Currents
                { label: 'Payload Draw', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Comms Draw', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'OBC Draw', data:[], borderColor: '#c5c6c7', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                
                // 13-15: Attitude
                { label: 'Pitch', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Roll', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Yaw', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                
                // 16-18: Environment & GPS
                { label: 'Pressure', data:[], borderColor: '#f1c40f', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Humidity', data:[], borderColor: '#66fcf1', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true },
                { label: 'Altitude', data:[], borderColor: '#00ff00', backgroundColor: 'transparent', fill: false, tension: 0.4, hidden: true }
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

// ─────────────────────────────────────────────────────
// 3. WEBSOCKET & FDIR TRACKING
// ─────────────────────────────────────────────────────
let passWatchdog = null; 

function triggerEPSPulse() {
    document.querySelectorAll('.dynamic-value').forEach(el => {
        el.classList.remove('pulse-update');
        void el.offsetWidth; 
        el.classList.add('pulse-update');
    });
}

function checkEPSAnomalies(eps, obc_temp, payload_temp, fdir_mode, payload_state, env) {
    const alertBox = document.getElementById('eps-alert-box');
    const statusBadge = document.getElementById('system-status-badge');
    if(!alertBox || !statusBadge) return;

    let alerts =[];

    if (fdir_mode === 'AUTO' && payload_state === 0 && (payload_temp > 50 || eps.soc < 20)) {
        alerts.push("⚠️ <strong>FDIR AUTONOMY EVENT:</strong> OBC has autonomously commanded Payload power OFF to protect the system.");
    }

    if (eps.soc <= 20) alerts.push("<strong>CRITICAL:</strong> SoC &lt; 20%. Manual Load Shedding recommended.");
    if (payload_temp > 50) alerts.push(`<strong>WARNING:</strong> Payload Temp approaching thermal limits (${payload_temp.toFixed(1)}°C).`);
    if (eps.v_3v3 < 3.0) alerts.push("<strong>CRITICAL BROWNOUT:</strong> 3.3V bus unstable. FDIR Reset imminent.");
    
    // Check new Environmental variables for anomalies
    if (env && env.pressure < 800) alerts.push("<strong>CRITICAL:</strong> Internal pressure dropping. Hull integrity compromise possible.");
    if (env && env.humidity > 40) alerts.push("<strong>WARNING:</strong> High internal humidity. Condensation risk to electronics.");

    if (alerts.length > 0) {
        alertBox.style.display = 'block'; 
        alertBox.innerHTML = alerts.join('<br>');
        statusBadge.className = 'badge danger-alert'; 
        statusBadge.style.display = 'inline-block'; 
        statusBadge.innerText = '❌ System: FDIR ACTIVE';
    } else {
        alertBox.style.display = 'none';
        statusBadge.className = 'badge nominal'; 
        statusBadge.innerText = '✅ System: NOMINAL'; 
        statusBadge.style.display = 'inline-block';
    }
}

if (socket) {
    socket.on('telemetry_update', (data) => {
        
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

        const satDate = new Date(data.timestamp * 1000);
        const satTimeString = satDate.toLocaleTimeString('en-GB');

        const fdirBadge = document.getElementById('badge-fdir-mode');
        if (fdirBadge) {
            if (data.fdir_mode === 'OVERRIDE') {
                fdirBadge.innerText = '🤖 FDIR: OVERRIDE';
                fdirBadge.style.color = '#f1c40f'; 
                fdirBadge.style.borderColor = '#f1c40f';
            } else {
                fdirBadge.innerText = '🤖 FDIR: AUTO';
                fdirBadge.style.color = '#66fcf1'; 
                fdirBadge.style.borderColor = '#66fcf1';
            }
        }

        const plBadge = document.getElementById('badge-payload-state');
        if (plBadge) {
            if (data.payload_state === 1) {
                plBadge.innerText = '📸 Payload: IMAGING'; 
                plBadge.style.color = '#f1c40f';
            } else if (data.payload_state === 2) {
                plBadge.innerText = '📡 Payload: DOWNLINKING'; 
                plBadge.style.color = '#66fcf1';
            } else {
                plBadge.innerText = '💤 Payload: IDLE/OFF'; 
                plBadge.style.color = '#c5c6c7';
            }
        }
        
        if (data.eps) {
            
            let i_payload = data.eps.i_payload !== undefined ? data.eps.i_payload : 0;
            let i_comms = data.eps.i_comms !== undefined ? data.eps.i_comms : 0;
            let i_obc = Math.max(0, data.eps.i_out - i_payload - i_comms);
            
            // Update 19-item Cache
            latestTelemetryCache[0] = data.rssi_gs;
            latestTelemetryCache[1] = data.rssi_uplink;
            latestTelemetryCache[2] = data.rssi_gsn;
            latestTelemetryCache[3] = data.obc_temp.toFixed(1);
            latestTelemetryCache[4] = data.payload_temp.toFixed(1);
            latestTelemetryCache[5] = data.eps.temp.toFixed(1);
            latestTelemetryCache[6] = data.eps.soc.toFixed(1);
            latestTelemetryCache[7] = data.eps.i_in;
            latestTelemetryCache[8] = data.eps.i_out;
            latestTelemetryCache[9] = data.eps.v_bat.toFixed(2);
            latestTelemetryCache[10] = i_payload;
            latestTelemetryCache[11] = i_comms;
            latestTelemetryCache[12] = i_obc;
            
            // New Attitude / Env / GPS updates in Cache
            if(data.attitude) {
                latestTelemetryCache[13] = data.attitude.pitch.toFixed(1);
                latestTelemetryCache[14] = data.attitude.roll.toFixed(1);
                latestTelemetryCache[15] = data.attitude.yaw.toFixed(1);
                
                const pEl = document.getElementById('val-att-pitch');
                const rEl = document.getElementById('val-att-roll');
                const yEl = document.getElementById('val-att-yaw');
                if (pEl) pEl.innerText = latestTelemetryCache[13] + '°';
                if (rEl) rEl.innerText = latestTelemetryCache[14] + '°';
                if (yEl) yEl.innerText = latestTelemetryCache[15] + '°';
            }
            
            if(data.env) {
                latestTelemetryCache[16] = data.env.pressure.toFixed(1);
                latestTelemetryCache[17] = data.env.humidity.toFixed(1);
                
                const prEl = document.getElementById('val-env-press');
                const huEl = document.getElementById('val-env-hum');
                if (prEl) prEl.innerText = latestTelemetryCache[16] + ' hPa';
                if (huEl) huEl.innerText = latestTelemetryCache[17] + ' %';
            }
            
            if(data.gps) {
                latestTelemetryCache[18] = data.gps.alt.toFixed(1);
                const altEl = document.getElementById('val-gps-alt');
                if (altEl) altEl.innerText = latestTelemetryCache[18] + ' km';
            }
            
            // Update EPS Boxes
            const socEl = document.getElementById('val-eps-soc');
            const iinEl = document.getElementById('val-eps-iin');
            const ioutEl = document.getElementById('val-eps-iout');
            const vbatEl = document.getElementById('val-eps-vbat');
            const v3v3El = document.getElementById('val-eps-3v3');
            const v5vEl = document.getElementById('val-eps-5v');
            
            const plDrawEl = document.getElementById('val-eps-ipayload');
            const cmDrawEl = document.getElementById('val-eps-icomms');
            const obDrawEl = document.getElementById('val-eps-iobc');

            if (socEl) socEl.innerText = data.eps.soc.toFixed(1) + '%';
            if (iinEl) iinEl.innerText = data.eps.i_in + ' mA';
            if (ioutEl) ioutEl.innerText = data.eps.i_out + ' mA';
            if (vbatEl) vbatEl.innerText = data.eps.v_bat.toFixed(2) + ' V';
            if (v3v3El) v3v3El.innerText = data.eps.v_3v3.toFixed(2) + ' V';
            if (v5vEl) v5vEl.innerText = data.eps.v_5v.toFixed(2) + ' V';
            
            if (plDrawEl) plDrawEl.innerText = i_payload + ' mA';
            if (cmDrawEl) cmDrawEl.innerText = i_comms + ' mA';
            if (obDrawEl) obDrawEl.innerText = i_obc + ' mA';

            // Charging/Discharging Logic
            const net = data.eps.i_in - data.eps.i_out;
            const stateEl = document.getElementById('val-eps-state');
            
            if (stateEl) {
                if (net > 0) {
                    stateEl.innerHTML = `🔋 CHARGING (+${net} mA)`;
                    stateEl.style.color = 'var(--success-green)';
                    stateEl.style.borderColor = 'var(--success-green)';
                } else if (net < 0) {
                    stateEl.innerHTML = `⚠️ DISCHARGING (${net} mA)`;
                    stateEl.style.color = 'var(--danger-red)';
                    stateEl.style.borderColor = 'var(--danger-red)';
                } else {
                    stateEl.innerHTML = `⚖️ BALANCED (0 mA)`;
                    stateEl.style.color = '#f1c40f';
                    stateEl.style.borderColor = '#f1c40f';
                }
            }

            checkEPSAnomalies(data.eps, data.obc_temp, data.payload_temp, data.fdir_mode, data.payload_state, data.env);
            triggerEPSPulse();
            
            const group = document.getElementById('chart-group')?.value;
            const metricName = document.getElementById('chart-metric')?.value;
            if(group && metricName) updateLiveTextValueDisplay(group, metricName);
        }

        if (window.signalChart) {
            window.signalChart.data.labels.push(satTimeString);
            
            window.signalChart.data.datasets[0].data.push(data.rssi_gs);
            window.signalChart.data.datasets[1].data.push(data.rssi_uplink);
            window.signalChart.data.datasets[2].data.push(data.rssi_gsn);
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
            
            // Push Attitude, Env, GPS
            window.signalChart.data.datasets[13].data.push(data.attitude ? data.attitude.pitch : 0);
            window.signalChart.data.datasets[14].data.push(data.attitude ? data.attitude.roll : 0);
            window.signalChart.data.datasets[15].data.push(data.attitude ? data.attitude.yaw : 0);
            window.signalChart.data.datasets[16].data.push(data.env ? data.env.pressure : 0);
            window.signalChart.data.datasets[17].data.push(data.env ? data.env.humidity : 0);
            window.signalChart.data.datasets[18].data.push(data.gps ? data.gps.alt : 0);

            if (window.signalChart.data.labels.length > 20) {
                window.signalChart.data.labels.shift();
                window.signalChart.data.datasets.forEach(ds => ds.data.shift());
            }
            window.signalChart.update();
        }

        if (data.lat && data.lng && satelliteMarker) {
            const pos =[data.lat, data.lng];
            satelliteMarker.setLatLng(pos);
            orbitPath.addLatLng(pos);
            map.panTo(pos, { animate: true, duration: 1.0 });
        }
        
        if (data.thermal) {
            updateThermalFromTelemetry(data.thermal);
        }
    });
}

// ─────────────────────────────────────────────────────
// 5. PAYLOAD ANALYZER — Sample loading
// ─────────────────────────────────────────────────────
const SAMPLE_LABELS = {
    'forest_healthy.jpg': '🌳 Healthy forest',
    'forest_deforested.jpg': '❌ Deforested area',
    'forest_burn.jpg': '🔥 Burn scar',
    'forest_rainforest.jpg': '🌿 Dense rainforest',
    'forest_stressed.jpg': '⚠️ Drought stressed',
};

async function loadSamples() {
    const ids = ['sample-select', 'before-select', 'after-select'];
    const sels = ids.map(id => document.getElementById(id)).filter(Boolean);
    
    if (!sels.length) return;
    
    try {
        const files = await fetch('/api/samples').then(r => r.json());
        
        sels.forEach(sel => {
            sel.innerHTML = '<option value="">-- select image --</option>';
            files.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.innerText = SAMPLE_LABELS[f] || f;
                sel.appendChild(opt);
            });
        });['before-select', 'after-select'].forEach(id => {
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

// ─────────────────────────────────────────────────────
// 6. RGB TAB — Image preview
// ─────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────
// 7. RGB TAB — OpenCV Analysis
// ─────────────────────────────────────────────────────
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
    if (data.bare_regions) allZones.push(...data.bare_regions);
    if (data.burn_regions) allZones.push(...data.burn_regions);
    
    const zoneWrap = document.getElementById('zone-list-wrap');
    const zoneList = document.getElementById('zone-list');
    
    if (allZones.length > 0) {
        zoneList.innerHTML = allZones.map((z, i) => {
            const confClass = z.confidence >= 80 ? 'conf-high' : 'conf-med';
            return `
            <div class="zone-item">
                <span class="zone-num">${i + 1}</span>
                <span class="zone-label">${z.label}</span>
                <span class="zone-area">${z.area_pct}% of image</span>
                <span class="zone-conf ${confClass}">${z.confidence}% Conf</span>
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

// ─────────────────────────────────────────────────────
// 8. RGB TAB — Canvas overlay
// ─────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────
// 9. THERMAL SCAN TAB
// ─────────────────────────────────────────────────────
const THERMAL_SCENARIOS = {
    normal: { 
        data:[
            24.1,23.8,24.5,25.0,24.3,23.9,24.7,25.2,
            24.8,25.1,24.6,23.7,24.2,25.4,24.9,24.0,
            25.3,24.4,23.6,24.1,25.0,24.8,23.5,24.3,
            24.0,25.2,24.7,23.9,24.4,25.1,24.6,23.8,
            23.7,24.3,25.0,24.6,23.8,24.1,25.3,24.5,
            24.9,23.5,24.2,25.1,24.7,23.6,24.0,25.4,
            25.0,24.8,23.9,24.4,25.2,24.3,23.7,24.6,
            24.1,25.3,24.5,23.8,24.0,25.1,24.7,23.9
        ], 
        interp: 'All cells within the 23–26°C baseline range. Canopy thermal regulation is functioning normally. No anomalies detected — forest health is nominal for this orbital pass.' 
    },
    stress: { 
        data:[
            26.2,27.1,28.4,29.0,28.7,27.5,26.8,26.1,
            27.4,29.3,31.2,33.5,34.1,32.8,30.4,27.9,
            28.1,31.0,35.6,38.2,39.4,37.1,33.2,29.3,
            27.6,30.4,37.1,41.8,43.2,40.5,35.7,30.1,
            27.2,29.8,35.4,40.1,42.6,39.3,34.1,29.4,
            28.0,30.2,33.8,36.5,37.9,35.2,31.6,28.7,
            27.1,28.6,30.4,32.1,33.0,31.4,29.2,27.5,
            26.4,27.3,28.1,29.4,30.2,28.9,27.6,26.3
        ], 
        interp: 'Elevated temperatures in the central grid cells (rows 3–5, cols 3–6), peaking at 43°C. Consistent with drought stress or early sub-surface smouldering. Cross-reference with ground sensor humidity and CO₂ before escalating.' 
    },
    fire: { 
        data:[
            25.1,26.3,28.7,34.2,41.5,38.4,30.1,26.8,
            26.4,29.8,36.4,48.7,62.3,57.8,42.1,30.5,
            27.2,33.1,44.6,61.5,76.4,71.2,55.3,36.8,
            28.0,35.4,52.3,69.8,81.5,78.4,61.2,41.3,
            27.8,34.1,49.7,65.3,79.2,75.1,58.4,38.7,
            26.9,31.5,42.8,55.6,68.4,63.2,48.9,33.4,
            26.1,28.4,35.2,44.1,53.7,49.8,38.6,29.2,
            25.4,26.7,29.3,35.8,42.4,39.1,31.5,27.1
        ], 
        interp: 'CRITICAL: Multiple cells exceeding the 70°C fire threshold. Active combustion detected — peak 81.5°C at grid[R4, C5]. Fire front spreading northeast based on thermal gradient. Notify Kenya Forest Service immediately.' 
    }
};

function thermalColor(temp) {
    const t = Math.max(0, Math.min(1, (temp - 20) / 60));
    if (t < 0.2) {
        return `rgb(0,${Math.round(t/0.2*130)},255)`;
    }
    if (t < 0.4) { 
        const p = (t-0.2)/0.2; 
        return `rgb(0,${Math.round(130+p*125)},${Math.round(255-p*255)})`; 
    }
    if (t < 0.6) { 
        const p = (t-0.4)/0.2; 
        return `rgb(${Math.round(p*255)},255,0)`; 
    }
    if (t < 0.8) { 
        const p = (t-0.6)/0.2; 
        return `rgb(255,${Math.round(255-p*160)},0)`; 
    }
    { 
        const p = (t-0.8)/0.2; 
        return `rgb(255,${Math.round(95-p*95)},0)`; 
    }
}

function loadThermal(scenarioName) {
    const scenario = THERMAL_SCENARIOS[scenarioName];
    if (!scenario) return;
    
    const data = scenario.data;
    const grid = document.getElementById('thermal-grid');
    if (!grid) return; 
    
    grid.innerHTML = '';
    
    const max = Math.max(...data);
    
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }
    const avg = sum / data.length;
    
    const hotspots =[];
    for (let i = 0; i < data.length; i++) {
        if (data[i] > 50) {
            hotspots.push({
                t: data[i],
                row: Math.floor(i / 8) + 1,
                col: (i % 8) + 1
            });
        }
    }
    
    hotspots.sort((a, b) => b.t - a.t);

    data.forEach((temp, i) => {
        const cell = document.createElement('div'); 
        cell.className = 'thermal-cell';
        cell.style.background = thermalColor(temp); 
        
        if (temp > 45) {
            cell.style.color = 'rgba(255,255,255,0.95)';
        } else {
            cell.style.color = 'rgba(0,0,0,0.75)';
        }
        
        cell.innerText = Math.round(temp); 
        cell.title = `[R${Math.floor(i/8)+1}, C${(i%8)+1}] ${temp.toFixed(1)}°C`;
        
        if (temp > 70) {
            cell.classList.add('cell-fire'); 
        } else if (temp > 50) {
            cell.classList.add('cell-hot');
        }
        
        grid.appendChild(cell);
    });
    
    document.getElementById('t-max').innerText = max.toFixed(1) + '°C'; 
    document.getElementById('t-max').style.color = thermalColor(max);
    
    document.getElementById('t-avg').innerText = avg.toFixed(1) + '°C'; 
    document.getElementById('t-hotspots').innerText = hotspots.length;
    
    let riskLevel = 'low';
    if (max > 70) riskLevel = 'critical';
    else if (max > 50) riskLevel = 'high';
    else if (max > 38) riskLevel = 'medium';
    
    setRiskBadge('t-risk', riskLevel);
    document.getElementById('t-interp').innerText = scenario.interp;

    const listEl = document.getElementById('t-hotspot-list');
    
    if (hotspots.length > 0) {
        listEl.innerHTML = hotspots.map(h => {
            let textColor = h.t > 70 ? '#e74c3c' : '#f1c40f';
            let riskClass = h.t > 70 ? 'critical' : (h.t > 55 ? 'high' : 'medium');
            let riskText = h.t > 70 ? 'FIRE' : (h.t > 55 ? 'HOT' : 'WARM');
            
            return `
            <div class="hotspot-row">
                <span>[R${h.row}, C${h.col}]</span>
                <span style="font-family:monospace; color:${textColor}; font-weight:bold;">
                    ${h.t.toFixed(1)}°C
                </span>
                <span class="risk-badge risk-${riskClass}">
                    ${riskText}
                </span>
            </div>`;
        }).join('');
    } else { 
        listEl.innerHTML = '<span style="color:var(--success-green); font-size:0.75rem;">✓ No hotspots detected.</span>'; 
    }
}

function updateThermalFromTelemetry(thermalArray) {
    if (!thermalArray || thermalArray.length !== 64) return;
    
    THERMAL_SCENARIOS['live'] = { 
        data: thermalArray, 
        interp: 'Live downlink — current orbital pass.' 
    };
    
    const payloadThermal = document.getElementById('payload-thermal');
    if (payloadThermal && payloadThermal.style.display !== 'none') {
        loadThermal('live');
    }
}

// ─────────────────────────────────────────────────────
// 10. CHANGE DETECTION TAB
// ─────────────────────────────────────────────────────
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
    
    const tabs =['rgb', 'thermal', 'change'];
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

// ── Initialization ──
if (document.getElementById('sample-select')) {
    loadSamples();
}

document.addEventListener("DOMContentLoaded", () => {
    // Populate dropdowns properly on load
    if(document.getElementById('chart-group')) {
        window.updateChartDropdowns();
    }
    
    if(document.getElementById('thermal-grid')) {
        loadThermal('normal');
    }
});