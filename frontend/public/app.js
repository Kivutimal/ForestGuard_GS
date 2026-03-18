// --- 1. KENYA TIME CLOCK (EAT) ---
function updateClock() {
    const clockElement = document.getElementById('mission-clock');
    if (clockElement) {
        const now = new Date();
        const nairobiTime = now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour12: false });
        clockElement.innerText = `EAT: ${nairobiTime}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

// --- 2. MAP LOGIC (Real-Time Tracking) ---
const mapElement = document.getElementById('map-container');
let satelliteMarker;
let orbitPath;
let map;

if (mapElement) {
    // Start view zoomed out to see the world
    map = L.map('map-container').setView([0, 0], 3);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { pane: 'shadowPane' }).addTo(map);

    const satIcon = L.divIcon({ html: '<div style="font-size: 24px; filter: drop-shadow(0 0 10px #66fcf1);">🛰️</div>', className: 'satellite-icon', iconSize: [30, 30] });
    satelliteMarker = L.marker([0, 0], { icon: satIcon }).addTo(map);
    satelliteMarker.bindPopup("<b>ForestGuard Alpha</b>");
    
    // Trail behind the satellite
    orbitPath = L.polyline([], {color: '#66fcf1', weight: 2, opacity: 0.6}).addTo(map);
}

// --- 3. CHART LOGIC (Selectable Plots) ---
const chartElement = document.getElementById('chart-container');
if (chartElement) {
    const ctx = document.createElement('canvas');
    chartElement.appendChild(ctx);
    window.signalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], 
            datasets:[
                { label: 'RSSI (dBm)', data: [], borderColor: '#66fcf1', backgroundColor: 'rgba(102, 252, 241, 0.1)', fill: true, tension: 0.4, hidden: false },
                { label: 'Battery (%)', data:[], borderColor: '#00ff00', backgroundColor: 'rgba(0, 255, 0, 0.1)', fill: true, tension: 0.4, hidden: true },
                { label: 'Temp (°C)', data:[], borderColor: '#ff9900', backgroundColor: 'rgba(255, 153, 0, 0.1)', fill: true, tension: 0.4, hidden: true }
            ]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } } } }
    });
}

window.showChart = function(index) {
    if (!window.signalChart) return;
    window.signalChart.data.datasets.forEach((ds, i) => ds.hidden = (i !== index));
    window.signalChart.update();
    document.querySelectorAll('.chart-btn').forEach((btn, i) => i === index ? btn.classList.add('active') : btn.classList.remove('active'));
};

// --- 4. SENSOR FUSION HEATMAP LOGIC ---
const slider = document.getElementById('opacity-slider');
const thermalCanvas = document.getElementById('thermal-canvas');
if (slider && thermalCanvas) slider.addEventListener('input', (e) => thermalCanvas.style.opacity = e.target.value / 100);

function getThermalColor(temp) {
    const p = Math.max(0, Math.min(100, ((temp - 20) / 60) * 100));
    if (p < 25) return `rgba(0, 0, 255, ${p/100})`;
    if (p < 75) return `rgba(255, 255, 0, 0.6)`;
    return `rgba(255, 0, 0, 0.8)`;
}

function drawHeatmap(thermalData) {
    const canvas = document.getElementById('thermal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellW = canvas.width / 8;
    const cellH = canvas.height / 8;
    let maxTemp = 0;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 64; i++) {
        const t = thermalData[i];
        if (t > maxTemp) maxTemp = t;
        ctx.fillStyle = getThermalColor(t);
        ctx.fillRect((i % 8) * cellW, Math.floor(i / 8) * cellH, cellW - 1, cellH - 1);
    }
    
    document.getElementById('thermal-max').innerText = maxTemp.toFixed(1);
    const alert = document.getElementById('fire-alert');
    const health = document.getElementById('forest-health');
    
    if (maxTemp > 70) { 
        alert.style.display = 'inline-block'; health.innerText = "CRITICAL: FIRE DETECTED"; health.className = "health-critical"; 
    } else if (maxTemp > 45) {
        alert.style.display = 'none'; health.innerText = "WARNING: THERMAL STRESS"; health.className = "health-warning";
    } else { 
        alert.style.display = 'none'; health.innerText = "EXCELLENT"; health.className = "health-stable"; 
    }
}

// --- 5. WEBSOCKET CONNECTION ---
const socket = io('http://localhost:8000');

socket.on('telemetry_update', (data) => {
    // Update Text
    document.getElementById('val-battery').innerText = data.battery.toFixed(1) + '%';
    document.getElementById('val-temp').innerText = data.sysTemp.toFixed(1) + '°C';
    document.getElementById('val-rssi').innerText = data.rssi + ' dBm';

    // Update Chart
    if (window.signalChart) {
        const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi', hour12: false });
        window.signalChart.data.labels.push(time);
        window.signalChart.data.datasets[0].data.push(data.rssi);
        window.signalChart.data.datasets[1].data.push(data.battery);
        window.signalChart.data.datasets[2].data.push(data.sysTemp);
        if (window.signalChart.data.labels.length > 20) {
            window.signalChart.data.labels.shift();
            window.signalChart.data.datasets.forEach(ds => ds.data.shift());
        }
        window.signalChart.update();
    }
    
    // Move Satellite on Map
    if (data.lat && data.lng && satelliteMarker) {
        const newPos = [data.lat, data.lng];
        satelliteMarker.setLatLng(newPos);
        orbitPath.addLatLng(newPos);
        
        // Follow the satellite
        map.panTo(newPos, { animate: true, duration: 1.0 });
    }

    if (data.thermal) drawHeatmap(data.thermal);
});

// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// PAYLOAD ANALYZER
// ─────────────────────────────────────────────────────

const SAMPLE_LABELS = {
    'forest_healthy.jpg':    '🌳 Healthy forest',
    'forest_deforested.jpg': '🪵 Deforested area',
    'forest_burn.jpg':       '🔥 Burn scar',
    'forest_rainforest.jpg': '🌿 Dense rainforest',
    'forest_stressed.jpg':   '⚠️ Drought stressed',
};

// Load sample filenames from Flask and populate all dropdowns
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
                opt.value     = f;
                opt.innerText = SAMPLE_LABELS[f] || f;
                sel.appendChild(opt);
            });
        });
        ['before-select', 'after-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', checkCompareReady);
        });
    } catch (e) {
        sels.forEach(sel => sel.innerHTML = '<option value="">⚠️ Backend offline</option>');
    }
}

// ── Image previews ──

function previewSample() {
    const sel = document.getElementById('sample-select');
    const box = document.getElementById('rgb-preview-box');
    const btn = document.getElementById('analyze-btn');
    if (!sel || !box) return;

    // Clear old content
    const img    = document.getElementById('rgb-img');
    const canvas = document.getElementById('rgb-canvas');
    img.style.display    = 'none';
    canvas.style.display = 'none';
    document.getElementById('rgb-legend').style.display = 'none';
    document.getElementById('rgb-results').style.display = 'none';
    box.querySelector('.loading-text') && (box.querySelector('.loading-text').style.display = 'none');
    btn.disabled = true;

    if (!sel.value) return;

    img.onload = () => {
        img.style.display = 'block';
        btn.disabled      = false;
        // Size canvas to match displayed image
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
    };
    img.src = '/samples/' + sel.value;
}

function previewChange(which) {
    const sel = document.getElementById(which + '-select');
    const img = document.getElementById(which + '-img');
    if (!sel || !img) return;
    if (!sel.value) return;
    img.src = '/samples/' + sel.value;
    img.style.display = 'block';
    const ph = document.getElementById(which + '-preview-box').querySelector('.loading-text');
    if (ph) ph.style.display = 'none';
    checkCompareReady();
}

function checkCompareReady() {
    const b   = document.getElementById('before-select');
    const a   = document.getElementById('after-select');
    const btn = document.getElementById('compare-btn');
    if (btn) btn.disabled = !(b && a && b.value && a.value);
}

// ── RGB OpenCV Analysis ──

async function runRGBAnalysis() {
    const sel = document.getElementById('sample-select');
    if (!sel || !sel.value) return;

    const btn     = document.getElementById('analyze-btn');
    const loading = document.getElementById('analyze-loading');
    btn.disabled = true;
    loading.style.display = 'flex';
    document.getElementById('rgb-results').style.display = 'none';

    try {
        const data = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: sel.value })
        }).then(r => r.json());

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

function renderRGBResults(d) {
    const scoreColor = d.health_score >= 70 ? 'var(--success-green)'
                     : d.health_score >= 40 ? '#f1c40f' : '#e74c3c';

    document.getElementById('r-score').innerText   = d.health_score;
    document.getElementById('r-score').style.color = scoreColor;
    document.getElementById('r-grade').innerText   = 'GRADE ' + d.health_grade;
    document.getElementById('r-ndvi').innerText    = d.ndvi_proxy.toFixed(2);
    document.getElementById('r-edge').innerText    = 'edges: ' + d.edge_density + '%';

    setBar('bar-veg',  'val-veg',  d.vegetation_pct);
    setBar('bar-bare', 'val-bare', d.bare_pct);
    setBar('bar-burn', 'val-burn', d.burn_pct);

    setRiskBadge('badge-fire',  d.fire_risk);
    setRiskBadge('badge-defor', d.deforestation_risk);

    // Zone list
    const allZones = [...(d.bare_regions || []), ...(d.burn_regions || [])];
    const zoneWrap = document.getElementById('zone-list-wrap');
    const zoneList = document.getElementById('zone-list');

    if (allZones.length) {
        zoneList.innerHTML = allZones.map((z, i) => `
            <div class="zone-item">
                <span class="zone-num">${i + 1}</span>
                <span class="zone-label">${z.label}</span>
                <span class="zone-area">${z.area_pct}% of image</span>
            </div>`).join('');
        zoneWrap.style.display = 'block';
    } else {
        zoneWrap.style.display = 'none';
    }

    document.getElementById('rgb-results').style.display = 'block';
}

// ── Canvas overlay — draw bounding boxes on the image ──

function drawRegions(data) {
    const img    = document.getElementById('rgb-img');
    const canvas = document.getElementById('rgb-canvas');
    if (!img || !canvas) return;

    // Match canvas pixels to the natural image size
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = canvas.width;
    const H = canvas.height;

    function drawBox(region, color, label) {
        const x = region.x * W;
        const y = region.y * H;
        const w = region.w * W;
        const h = region.h * H;

        // Semi-transparent fill
        ctx.fillStyle = color.replace(')', ', 0.12)').replace('rgb', 'rgba');
        ctx.fillRect(x, y, w, h);

        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth   = Math.max(2, W * 0.003);
        ctx.strokeRect(x, y, w, h);

        // Label tag
        const fontSize = Math.max(11, W * 0.018);
        ctx.font      = `bold ${fontSize}px monospace`;
        const textW   = ctx.measureText(label).width + 10;
        const tagH    = fontSize + 8;

        ctx.fillStyle = color;
        ctx.fillRect(x, y - tagH, textW, tagH);

        ctx.fillStyle = '#000';
        ctx.fillText(label, x + 5, y - 4);
    }

    (data.bare_regions || []).forEach((r, i) =>
        drawBox(r, 'rgb(241, 196, 15)', `Zone ${i + 1}: Cleared`));

    (data.burn_regions || []).forEach((r, i) =>
        drawBox(r, 'rgb(231, 76, 60)',  `Zone ${i + 1}: Burn`));

    const hasRegions = (data.bare_regions?.length || 0) + (data.burn_regions?.length || 0) > 0;
    canvas.style.display = hasRegions ? 'block' : 'none';
    document.getElementById('rgb-legend').style.display = hasRegions ? 'flex' : 'none';
}

// ── Change Detection ──

async function runChangeDetect() {
    const before = document.getElementById('before-select').value;
    const after  = document.getElementById('after-select').value;
    if (!before || !after) return;

    const btn     = document.getElementById('compare-btn');
    const loading = document.getElementById('compare-loading');
    btn.disabled = true;
    loading.style.display = 'flex';
    document.getElementById('change-results').style.display = 'none';

    try {
        const data = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ before, after })
        }).then(r => r.json());

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

function renderChangeResults(d) {
    document.getElementById('ch-change').innerText  = d.change_pct + '%';
    document.getElementById('ch-regions').innerText = d.change_regions;

    const dEl = document.getElementById('ch-veg-delta');
    dEl.innerText    = (d.veg_delta >= 0 ? '+' : '') + d.veg_delta + '%';
    dEl.style.color  = d.veg_delta >= 0 ? 'var(--success-green)' : '#e74c3c';

    setBar('bar-veg-b', 'val-veg-b', d.veg_before);
    setBar('bar-veg-a', 'val-veg-a', d.veg_after);

    const deforested = d.veg_delta < -10 || d.bare_delta > 10;
    const flagEl = document.getElementById('ch-defor-flag');
    flagEl.innerText   = deforested ? '⚠️ YES — Vegetation loss detected' : '✓ Not detected';
    flagEl.style.color = deforested ? '#e74c3c' : 'var(--success-green)';

    const bEl = document.getElementById('ch-bare-delta');
    bEl.innerText   = (d.bare_delta >= 0 ? '+' : '') + d.bare_delta + '%';
    bEl.style.color = d.bare_delta > 5 ? '#e74c3c' : '#f1c40f';

    document.getElementById('change-results').style.display = 'block';
}

function drawChangeRegions(data) {
    const img    = document.getElementById('after-img');
    const canvas = document.getElementById('after-canvas');
    if (!img || !canvas) return;

    canvas.width  = img.naturalWidth  || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const W = canvas.width;
    const H = canvas.height;

    function drawBox(region, color, label) {
        const x = region.x * W, y = region.y * H;
        const w = region.w * W, h = region.h * H;
        ctx.fillStyle   = color.replace(')', ', 0.15)').replace('rgb', 'rgba');
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth   = Math.max(2, W * 0.003);
        ctx.strokeRect(x, y, w, h);
        const fontSize  = Math.max(11, W * 0.018);
        ctx.font        = `bold ${fontSize}px monospace`;
        const textW     = ctx.measureText(label).width + 10;
        const tagH      = fontSize + 8;
        ctx.fillStyle   = color;
        ctx.fillRect(x, y - tagH, textW, tagH);
        ctx.fillStyle   = '#000';
        ctx.fillText(label, x + 5, y - 4);
    }

    (data.new_bare_regions || []).forEach((r, i) =>
        drawBox(r, 'rgb(231, 76, 60)',   `New clearing ${i + 1}`));
    (data.change_boxes || []).forEach((r, i) =>
        drawBox(r, 'rgb(243, 156, 18)',  `Change ${i + 1}`));

    const hasRegions = (data.new_bare_regions?.length || 0) + (data.change_boxes?.length || 0) > 0;
    canvas.style.display = hasRegions ? 'block' : 'none';
    document.getElementById('change-legend').style.display = hasRegions ? 'flex' : 'none';
}

// ── Tab switching ──

function switchPayloadTab(tab) {
    document.getElementById('payload-rgb').style.display      = tab === 'rgb'     ? 'block' : 'none';
    document.getElementById('payload-thermal').style.display  = tab === 'thermal' ? 'block' : 'none';
    document.getElementById('payload-change').style.display   = tab === 'change'  ? 'block' : 'none';
    const tabs = ['rgb', 'thermal', 'change'];
    document.querySelectorAll('.payload-tabs .chart-btn').forEach((btn, i) => {
        btn.classList.toggle('active', tabs[i] === tab);
    });
}

// ── Helpers ──

function setBar(barId, valId, pct) {
    document.getElementById(barId).style.width = Math.min(100, pct) + '%';
    document.getElementById(valId).innerText   = pct + '%';
}

function setRiskBadge(id, level) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'risk-badge risk-' + level;
    el.innerText = level.toUpperCase();
}

// Auto-init on dashboard page
if (document.getElementById('sample-select')) loadSamples();

// ─────────────────────────────────────────────────────
// THERMAL SCAN — AMG8833 8×8 grid
// ─────────────────────────────────────────────────────

// Recorded pass scenarios — each is a flat 64-value array (row-major, 8×8)
// These represent real-world AMG8833 output ranges
const THERMAL_SCENARIOS = {

    normal: {
        data: [
            24.1, 23.8, 24.5, 25.0, 24.3, 23.9, 24.7, 25.2,
            24.8, 25.1, 24.6, 23.7, 24.2, 25.4, 24.9, 24.0,
            25.3, 24.4, 23.6, 24.1, 25.0, 24.8, 23.5, 24.3,
            24.0, 25.2, 24.7, 23.9, 24.4, 25.1, 24.6, 23.8,
            23.7, 24.3, 25.0, 24.6, 23.8, 24.1, 25.3, 24.5,
            24.9, 23.5, 24.2, 25.1, 24.7, 23.6, 24.0, 25.4,
            25.0, 24.8, 23.9, 24.4, 25.2, 24.3, 23.7, 24.6,
            24.1, 25.3, 24.5, 23.8, 24.0, 25.1, 24.7, 23.9
        ],
        interp: "All cells within the 23–26°C baseline range. Canopy thermal regulation is functioning normally. No anomalies detected — forest health is nominal for this orbital pass."
    },

    stress: {
        data: [
            26.2, 27.1, 28.4, 29.0, 28.7, 27.5, 26.8, 26.1,
            27.4, 29.3, 31.2, 33.5, 34.1, 32.8, 30.4, 27.9,
            28.1, 31.0, 35.6, 38.2, 39.4, 37.1, 33.2, 29.3,
            27.6, 30.4, 37.1, 41.8, 43.2, 40.5, 35.7, 30.1,
            27.2, 29.8, 35.4, 40.1, 42.6, 39.3, 34.1, 29.4,
            28.0, 30.2, 33.8, 36.5, 37.9, 35.2, 31.6, 28.7,
            27.1, 28.6, 30.4, 32.1, 33.0, 31.4, 29.2, 27.5,
            26.4, 27.3, 28.1, 29.4, 30.2, 28.9, 27.6, 26.3
        ],
        interp: "Elevated temperatures detected in the central grid cells (rows 3–5, cols 3–6), peaking at 43°C. This pattern is consistent with drought stress or early sub-surface smouldering. Recommend cross-referencing with ground sensor humidity and CO₂ readings before escalating."
    },

    fire: {
        data: [
            25.1, 26.3, 28.7, 34.2, 41.5, 38.4, 30.1, 26.8,
            26.4, 29.8, 36.4, 48.7, 62.3, 57.8, 42.1, 30.5,
            27.2, 33.1, 44.6, 61.5, 76.4, 71.2, 55.3, 36.8,
            28.0, 35.4, 52.3, 69.8, 81.5, 78.4, 61.2, 41.3,
            27.8, 34.1, 49.7, 65.3, 79.2, 75.1, 58.4, 38.7,
            26.9, 31.5, 42.8, 55.6, 68.4, 63.2, 48.9, 33.4,
            26.1, 28.4, 35.2, 44.1, 53.7, 49.8, 38.6, 29.2,
            25.4, 26.7, 29.3, 35.8, 42.4, 39.1, 31.5, 27.1
        ],
        interp: "CRITICAL: Multiple cells exceeding the 70°C fire threshold. Active combustion signature detected — peak reading 81.5°C in grid cell [R4, C5]. Fire front appears to be spreading northeast based on the thermal gradient. Notify Kenya Forest Service immediately and flag for next orbital pass confirmation."
    }
};

// Maps a temperature to a colour across the blue→cyan→green→yellow→orange→red spectrum
function thermalColor(temp) {
    const t = Math.max(0, Math.min(1, (temp - 20) / 60));
    if (t < 0.2)  return `rgb(0, ${Math.round(t / 0.2 * 130)}, 255)`;
    if (t < 0.4)  { const p = (t - 0.2) / 0.2; return `rgb(0, ${Math.round(130 + p * 125)}, ${Math.round(255 - p * 255)})`; }
    if (t < 0.6)  { const p = (t - 0.4) / 0.2; return `rgb(${Math.round(p * 255)}, 255, 0)`; }
    if (t < 0.8)  { const p = (t - 0.6) / 0.2; return `rgb(255, ${Math.round(255 - p * 160)}, 0)`; }
    { const p = (t - 0.8) / 0.2; return `rgb(255, ${Math.round(95 - p * 95)}, 0)`; }
}

function loadThermal(scenarioName) {
    const scenario = THERMAL_SCENARIOS[scenarioName];
    if (!scenario) return;

    const data = scenario.data;
    const grid = document.getElementById('thermal-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const max  = Math.max(...data);
    const avg  = data.reduce((a, b) => a + b, 0) / data.length;
    const hotspots = data
        .map((t, i) => ({ t, row: Math.floor(i / 8) + 1, col: (i % 8) + 1 }))
        .filter(h => h.t > 50)
        .sort((a, b) => b.t - a.t);

    // Render the 8×8 grid cells
    data.forEach((temp, i) => {
        const cell = document.createElement('div');
        cell.className = 'thermal-cell';
        cell.style.background = thermalColor(temp);

        // White text on hot cells, dark on cool
        cell.style.color = temp > 45 ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.75)';
        cell.innerText   = Math.round(temp);

        const row = Math.floor(i / 8) + 1;
        const col = (i % 8) + 1;
        cell.title = `[R${row}, C${col}]  ${temp.toFixed(1)}°C`;

        // Pulse animation on fire cells
        if (temp > 70) cell.classList.add('cell-fire');
        else if (temp > 50) cell.classList.add('cell-hot');

        grid.appendChild(cell);
    });

    // Max temp bar colour
    const maxPct = Math.max(0, Math.min(100, ((max - 20) / 60) * 100));
    document.getElementById('t-max').innerText      = max.toFixed(1) + '°C';
    document.getElementById('t-max').style.color    = thermalColor(max);
    document.getElementById('t-avg').innerText      = avg.toFixed(1) + '°C';
    document.getElementById('t-hotspots').innerText = hotspots.length;

    // Risk badge
    const risk = max > 70 ? 'critical' : max > 50 ? 'high' : max > 38 ? 'medium' : 'low';
    setRiskBadge('t-risk', risk);

    // Interpretation text
    document.getElementById('t-interp').innerText = scenario.interp;

    // Hotspot coordinate list
    const listEl = document.getElementById('t-hotspot-list');
    if (hotspots.length) {
        listEl.innerHTML = hotspots.map(h => `
            <div class="hotspot-row">
                <span style="color:var(--text-silver);">Grid [R${h.row}, C${h.col}]</span>
                <span style="font-family:monospace; color:${h.t > 70 ? '#e74c3c' : '#f1c40f'}; font-weight:bold;">${h.t.toFixed(1)}°C</span>
                <span class="risk-badge risk-${h.t > 70 ? 'critical' : h.t > 55 ? 'high' : 'medium'}">${h.t > 70 ? 'FIRE' : h.t > 55 ? 'HOT' : 'WARM'}</span>
            </div>`).join('');
    } else {
        listEl.innerHTML = '<span style="color:var(--success-green); font-size:0.75rem;">✓ No hotspots detected.</span>';
    }
}

// If the thermal tab is open, also update it when live telemetry arrives
// (for when you eventually get the real AMG8833 downlinking data)
function updateThermalFromTelemetry(thermalArray) {
    if (!thermalArray || thermalArray.length !== 64) return;
    // Inject live data directly as a scenario-like object
    const live = { data: thermalArray, interp: 'Live downlink — current orbital pass.' };
    THERMAL_SCENARIOS['live'] = live;
    if (document.getElementById('payload-thermal').style.display !== 'none') {
        loadThermal('live');
    }
}