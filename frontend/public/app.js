const socket = io('http://localhost:8000');

// ─────────────────────────────────────────────────────
// 1. KENYA TIME CLOCK (EAT)
// ─────────────────────────────────────────────────────
function updateClock() {
    const el = document.getElementById('mission-clock');
    if (el) {
        const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour12: false });
        el.innerText = `EAT: ${t}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────────────
// 2. MAP (Real-Time Orbital Tracking)
// ─────────────────────────────────────────────────────
const mapElement = document.getElementById('map-container');
let satelliteMarker, orbitPath, map;

if (mapElement) {
    map = L.map('map-container').setView([0, 0], 3);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { pane: 'shadowPane' }).addTo(map);

    const satIcon = L.divIcon({
        html: '<div style="font-size:24px; filter:drop-shadow(0 0 10px #66fcf1);">🛰️</div>',
        className: 'satellite-icon', iconSize: [30, 30]
    });

    satelliteMarker = L.marker([0, 0], { icon: satIcon }).addTo(map);
    satelliteMarker.bindPopup('<b>ForestGuard Alpha</b>');
    orbitPath = L.polyline([], { color: '#66fcf1', weight: 2, opacity: 0.6 }).addTo(map);
}

// ─────────────────────────────────────────────────────
// 3. TELEMETRY CHART (Expanded with EPS Data)
// ─────────────────────────────────────────────────────
const chartElement = document.getElementById('chart-container');
if (chartElement) {
    const ctx = document.createElement('canvas');
    chartElement.appendChild(ctx);
    
    window.signalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'RSSI (dBm)', data: [], borderColor: '#66fcf1', backgroundColor: 'rgba(102,252,241,0.1)', fill: true, tension: 0.4, hidden: false },
                { label: 'Battery (%)', data:[], borderColor: '#00ff00', backgroundColor: 'rgba(0,255,0,0.1)', fill: true, tension: 0.4, hidden: true },
                { label: 'Temp (°C)', data:[], borderColor: '#ff9900', backgroundColor: 'rgba(255,153,0,0.1)', fill: true, tension: 0.4, hidden: true },
                // NEW EPS DATASETS
                { label: 'Solar In (mA)', data:[], borderColor: '#f1c40f', backgroundColor: 'rgba(241,196,15,0.1)', fill: true, tension: 0.4, hidden: true },
                { label: 'Total Load (mA)', data:[], borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', fill: true, tension: 0.4, hidden: true }
            ]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.05)' } } }
        }
    });
}

window.showChart = function(index) {
    if (!window.signalChart) return;
    window.signalChart.data.datasets.forEach((ds, i) => ds.hidden = (i !== index));
    window.signalChart.update();
    document.querySelectorAll('.chart-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
};

// ─────────────────────────────────────────────────────
// 4. WEBSOCKET — Live telemetry & EPS Handling
// ─────────────────────────────────────────────────────

// EPS Anomaly Detection Function
function checkEPSAnomalies(eps) {
    const alertBox = document.getElementById('eps-alert-box');
    const statusBadge = document.getElementById('system-status-badge');
    let alerts =[];

    // 1. Critical Low Battery
    if (eps.soc <= 20) {
        alerts.push("<strong>CRITICAL:</strong> SoC &lt; 20%. Recommend initiating Load Shedding protocol.");
    }
    // 2. Payload Latch-up (Overcurrent)
    if (eps.i_payload > 400) {
        alerts.push(`<strong>WARNING:</strong> Payload overcurrent detected (${eps.i_payload}mA). Possible Single Event Latch-up (SEL). Power cycle recommended.`);
    }
    // 3. Thermal Safing
    if (eps.temp > 40) {
        alerts.push(`<strong>WARNING:</strong> Battery cell temp exceeding safe threshold (${eps.temp.toFixed(1)}°C).`);
    }

    if (alerts.length > 0) {
        alertBox.style.display = 'block';
        alertBox.innerHTML = alerts.join('<br>');
        
        // Update global mission status
        statusBadge.className = 'badge danger-alert';
        statusBadge.style.display = 'inline-block';
        statusBadge.innerText = '❌ System: ANOMALY';
    } else {
        alertBox.style.display = 'none';
        
        // Restore global mission status
        statusBadge.className = 'badge nominal';
        statusBadge.innerText = '✅ System: NOMINAL';
        statusBadge.style.display = 'inline-block';
    }
}

socket.on('telemetry_update', (data) => {
    // 1. Update Legacy Basic Stats Row
    const b = document.getElementById('val-battery');
    const t = document.getElementById('val-temp');
    const r = document.getElementById('val-rssi');
    
    if (b) b.innerText = (data.eps ? data.eps.soc : data.battery).toFixed(1) + '%';
    if (t) t.innerText = data.sysTemp.toFixed(1) + '°C';
    if (r) r.innerText = data.rssi + ' dBm';

    // 2. Update NEW EPS Subsystem Panel if data exists
    if (data.eps) {
        document.getElementById('val-eps-vbat').innerText = data.eps.v_bat.toFixed(2) + ' V';
        document.getElementById('val-eps-iin').innerText = data.eps.i_in + ' mA';
        document.getElementById('val-eps-iout').innerText = data.eps.i_out + ' mA';

        // Calculate and colorize Net Power
        const net = data.eps.i_in - data.eps.i_out;
        const netEl = document.getElementById('val-eps-net');
        if (netEl) {
            netEl.innerText = net > 0 ? `Net: +${net} mA` : `Net: ${net} mA`;
            netEl.style.color = net > 0 ? 'var(--success-green)' : (net < -500 ? 'var(--danger-red)' : '#f1c40f');
        }

        // Run Anomaly Detection
        checkEPSAnomalies(data.eps);
    }

    // 3. Update Chart.js Data
    if (window.signalChart) {
        const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour12: false });
        window.signalChart.data.labels.push(time);
        
        window.signalChart.data.datasets[0].data.push(data.rssi);
        window.signalChart.data.datasets[1].data.push(data.eps ? data.eps.soc : data.battery);
        window.signalChart.data.datasets[2].data.push(data.sysTemp);
        
        // Push EPS Chart data (defaults to 0 if legacy format sent)
        window.signalChart.data.datasets[3].data.push(data.eps ? data.eps.i_in : 0);
        window.signalChart.data.datasets[4].data.push(data.eps ? data.eps.i_out : 0);

        if (window.signalChart.data.labels.length > 20) {
            window.signalChart.data.labels.shift();
            window.signalChart.data.datasets.forEach(ds => ds.data.shift());
        }
        window.signalChart.update();
    }

    // 4. Update Map Position
    if (data.lat && data.lng && satelliteMarker) {
        const pos = [data.lat, data.lng];
        satelliteMarker.setLatLng(pos);
        orbitPath.addLatLng(pos);
        map.panTo(pos, { animate: true, duration: 1.0 });
    }

    // 5. Pass live thermal data
    if (data.thermal) updateThermalFromTelemetry(data.thermal);
});


// ─────────────────────────────────────────────────────
// 5. PAYLOAD ANALYZER — Sample loading (PRESERVED EXACTLY)
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
            if (el) el.addEventListener('change', checkCompareReady);
        });
    } catch (e) {
        sels.forEach(sel => sel.innerHTML = '<option value="">⚠️ Backend offline</option>');
    }
}

// ─────────────────────────────────────────────────────
// 6. RGB TAB — Image preview (PRESERVED EXACTLY)
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
    if (ph) ph.style.display = sel.value ? 'none' : 'block';
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
// 7. RGB TAB — OpenCV Analysis (PRESERVED EXACTLY)
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
        if (data.error) throw new Error(data.error);
        
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
    const scoreColor = data.health_score >= 70 ? 'var(--success-green)' 
                     : data.health_score >= 40 ? '#f1c40f' 
                     : '#e74c3c';

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

    const allZones = [...(data.bare_regions || []), ...(data.burn_regions ||[])];
    const zoneWrap = document.getElementById('zone-list-wrap');
    const zoneList = document.getElementById('zone-list');

    if (allZones.length) {
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
        roadAlert.style.display = data.road_count >= 4 ? 'block' : 'none';
    } else {
        roadWrap.style.display = 'none';
    }
    document.getElementById('rgb-results').style.display = 'block';
}

// ─────────────────────────────────────────────────────
// 8. RGB TAB — Canvas overlay (PRESERVED EXACTLY)
// ─────────────────────────────────────────────────────
function drawRegions(data) {
    const img = document.getElementById('rgb-img');
    const canvas = document.getElementById('rgb-canvas');
    if (!img || !canvas) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const W = canvas.width;
    const H = canvas.height;

    function drawBox(region, color, label) {
        const x = region.x * W, y = region.y * H;
        const w = region.w * W, h = region.h * H;
        
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

    (data.bare_regions ||[]).forEach((r, i) => drawBox(r, 'rgb(241,196,15)', `Zone ${i + 1}: Cleared`));
    (data.burn_regions ||[]).forEach((r, i) => drawBox(r, 'rgb(231,76,60)', `Zone ${i + 1}: Burn`));

    (data.road_segments ||[]).forEach((seg, i) => {
        const x1 = seg.x1 * W, y1 = seg.y1 * H;
        const x2 = seg.x2 * W, y2 = seg.y2 * H;
        
        ctx.strokeStyle = 'rgba(0,200,255,0.85)';
        ctx.lineWidth = Math.max(2, W * 0.004);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (i < 4) {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
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

    const hasContent = (data.bare_regions?.length || 0) + (data.burn_regions?.length || 0) + (data.road_segments?.length || 0) > 0;
    canvas.style.display = hasContent ? 'block' : 'none';
    document.getElementById('rgb-legend').style.display = hasContent ? 'flex' : 'none';
}

// ─────────────────────────────────────────────────────
// 9. THERMAL SCAN TAB (PRESERVED EXACTLY)
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
        interp: 'CRITICAL: Multiple cells exceeding the 70°C fire threshold. Active combustion detected — peak 81.5°C at grid [R4, C5]. Fire front spreading northeast based on thermal gradient. Notify Kenya Forest Service immediately.'
    }
};

function thermalColor(temp) {
    const t = Math.max(0, Math.min(1, (temp - 20) / 60));
    if (t < 0.2) return `rgb(0,${Math.round(t/0.2*130)},255)`;
    if (t < 0.4) { const p=(t-0.2)/0.2; return `rgb(0,${Math.round(130+p*125)},${Math.round(255-p*255)})`; }
    if (t < 0.6) { const p=(t-0.4)/0.2; return `rgb(${Math.round(p*255)},255,0)`; }
    if (t < 0.8) { const p=(t-0.6)/0.2; return `rgb(255,${Math.round(255-p*160)},0)`; }
    { const p=(t-0.8)/0.2; return `rgb(255,${Math.round(95-p*95)},0)`; }
}

function loadThermal(scenarioName) {
    const scenario = THERMAL_SCENARIOS[scenarioName];
    if (!scenario) return;

    const data = scenario.data;
    const grid = document.getElementById('thermal-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const max = Math.max(...data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    
    const hotspots = data
        .map((t, i) => ({ t, row: Math.floor(i / 8) + 1, col: (i % 8) + 1 }))
        .filter(h => h.t > 50)
        .sort((a, b) => b.t - a.t);

    data.forEach((temp, i) => {
        const cell = document.createElement('div');
        cell.className = 'thermal-cell';
        cell.style.background = thermalColor(temp);
        cell.style.color = temp > 45 ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.75)';
        cell.innerText = Math.round(temp);
        cell.title = `[R${Math.floor(i/8)+1}, C${(i%8)+1}] ${temp.toFixed(1)}°C`;
        
        if (temp > 70) cell.classList.add('cell-fire');
        else if (temp > 50) cell.classList.add('cell-hot');
        
        grid.appendChild(cell);
    });

    document.getElementById('t-max').innerText = max.toFixed(1) + '°C';
    document.getElementById('t-max').style.color = thermalColor(max);
    document.getElementById('t-avg').innerText = avg.toFixed(1) + '°C';
    document.getElementById('t-hotspots').innerText = hotspots.length;

    const risk = max > 70 ? 'critical' : max > 50 ? 'high' : max > 38 ? 'medium' : 'low';
    setRiskBadge('t-risk', risk);
    document.getElementById('t-interp').innerText = scenario.interp;

    const listEl = document.getElementById('t-hotspot-list');
    if (hotspots.length) {
        listEl.innerHTML = hotspots.map(h => `
        <div class="hotspot-row">
            <span>[R${h.row}, C${h.col}]</span>
            <span style="font-family:monospace; color:${h.t>70?'#e74c3c':'#f1c40f'}; font-weight:bold;">${h.t.toFixed(1)}°C</span>
            <span class="risk-badge risk-${h.t>70?'critical':h.t>55?'high':'medium'}">${h.t>70?'FIRE':h.t>55?'HOT':'WARM'}</span>
        </div>`).join('');
    } else {
        listEl.innerHTML = '<span style="color:var(--success-green); font-size:0.75rem;">✓ No hotspots detected.</span>';
    }
}

function updateThermalFromTelemetry(thermalArray) {
    if (!thermalArray || thermalArray.length !== 64) return;
    THERMAL_SCENARIOS['live'] = { data: thermalArray, interp: 'Live downlink — current orbital pass.' };
    
    if (document.getElementById('payload-thermal') && 
        document.getElementById('payload-thermal').style.display !== 'none') {
        loadThermal('live');
    }
}

// ─────────────────────────────────────────────────────
// 10. CHANGE DETECTION TAB (PRESERVED EXACTLY)
// ─────────────────────────────────────────────────────
function previewChange(which) {
    const sel = document.getElementById(which + '-select');
    const img = document.getElementById(which + '-img');
    if (!sel || !img || !sel.value) return;
    
    img.src = '/samples/' + sel.value;
    img.style.display = 'block';
    
    const ph = document.getElementById(which + '-preview-box').querySelector('.loading-text');
    if (ph) ph.style.display = 'none';
    
    checkCompareReady();
}

function checkCompareReady() {
    const b = document.getElementById('before-select');
    const a = document.getElementById('after-select');
    const btn = document.getElementById('compare-btn');
    if (btn) btn.disabled = !(b && a && b.value && a.value);
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
        if (data.error) throw new Error(data.error);
        
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
    dEl.style.color = data.veg_delta >= 0 ? 'var(--success-green)' : '#e74c3c';

    setBar('bar-veg-b', 'val-veg-b', data.veg_before);
    setBar('bar-veg-a', 'val-veg-a', data.veg_after);

    const defor = data.veg_delta < -10 || data.bare_delta > 10;
    const flagEl = document.getElementById('ch-defor-flag');
    flagEl.innerText = defor ? '⚠️ YES — Vegetation loss detected' : '✓ Not detected';
    flagEl.style.color = defor ? '#e74c3c' : 'var(--success-green)';

    const bEl = document.getElementById('ch-bare-delta');
    bEl.innerText = (data.bare_delta >= 0 ? '+' : '') + data.bare_delta + '%';
    bEl.style.color = data.bare_delta > 5 ? '#e74c3c' : '#f1c40f';

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
    const W = canvas.width, H = canvas.height;

    function drawBox(region, color, label) {
        const x = region.x * W, y = region.y * H;
        const w = region.w * W, h = region.h * H;
        
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

    (data.new_bare_regions ||[]).forEach((r, i) => drawBox(r, 'rgb(231,76,60)', `New clearing ${i + 1}`));
    (data.change_boxes ||[]).forEach((r, i) => drawBox(r, 'rgb(243,156,18)', `Change ${i + 1}`));

    const hasRegions = (data.new_bare_regions?.length || 0) + (data.change_boxes?.length || 0) > 0;
    canvas.style.display = hasRegions ? 'block' : 'none';
    document.getElementById('change-legend').style.display = hasRegions ? 'flex' : 'none';
}

// ─────────────────────────────────────────────────────
// 11. TAB SWITCHING
// ─────────────────────────────────────────────────────
function switchPayloadTab(tab) {
    document.getElementById('payload-rgb').style.display = tab === 'rgb' ? 'block' : 'none';
    document.getElementById('payload-thermal').style.display = tab === 'thermal' ? 'block' : 'none';
    document.getElementById('payload-change').style.display = tab === 'change' ? 'block' : 'none';
    
    const tabs = ['rgb', 'thermal', 'change'];
    document.querySelectorAll('.payload-tabs .chart-btn').forEach((btn, i) => {
        btn.classList.toggle('active', tabs[i] === tab);
    });
}

// ─────────────────────────────────────────────────────
// 12. SHARED HELPERS
// ─────────────────────────────────────────────────────
function setBar(barId, valId, pct) {
    const b = document.getElementById(barId);
    const v = document.getElementById(valId);
    if (b) b.style.width = Math.min(100, pct) + '%';
    if (v) v.innerText = pct + '%';
}

function setRiskBadge(id, level) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'risk-badge risk-' + level;
    el.innerText = level.toUpperCase();
}

// Auto-init on load
if (document.getElementById('sample-select')) loadSamples();