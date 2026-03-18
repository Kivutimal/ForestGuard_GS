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
// PAYLOAD ANALYZER — talks to Flask OpenCV endpoints
// ─────────────────────────────────────────────────────

// Load sample list from backend on page load
async function loadSamples() {
    const selectors = ['sample-select','before-select','after-select'].map(id => document.getElementById(id)).filter(Boolean);
    if (!selectors.length) return;

    try {
        const res   = await fetch('/api/samples');
        const files = await res.json();

        const LABELS = {
            'forest_healthy.jpg':     '🌳 Healthy forest',
            'forest_deforested.jpg':  '🪵 Deforested area',
            'forest_burn.jpg':        '🔥 Burn scar',
            'forest_rainforest.jpg':  '🌿 Dense rainforest',
            'forest_stressed.jpg':    '⚠️ Drought stressed',
        };

        selectors.forEach(sel => {
            sel.innerHTML = '<option value="">-- select image --</option>';
            files.forEach(f => {
                const opt   = document.createElement('option');
                opt.value   = f;
                opt.innerText = LABELS[f] || f;
                sel.appendChild(opt);
            });
        });

        // Enable compare button only when both are selected
        ['before-select','after-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', checkCompareReady);
        });

    } catch(e) {
        selectors.forEach(sel => {
            sel.innerHTML = '<option value="">⚠️ Backend offline</option>';
        });
    }
}

// Preview selected sample in the RGB tab
function previewSample() {
    const sel = document.getElementById('sample-select');
    const box = document.getElementById('rgb-preview-box');
    const btn = document.getElementById('analyze-btn');
    if (!sel || !box) return;

    box.innerHTML = '';
    if (!sel.value) { btn.disabled = true; return; }

    const img = document.createElement('img');
    img.src = '/samples/' + sel.value;
    img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
    box.appendChild(img);
    btn.disabled = false;
    document.getElementById('rgb-results').style.display = 'none';
}

// Preview in change detection tab
function previewChange(which) {
    const sel = document.getElementById(which + '-select');
    const box = document.getElementById(which + '-preview-box');
    if (!sel || !box) return;

    box.innerHTML = '';
    if (!sel.value) return;

    const img = document.createElement('img');
    img.src = '/samples/' + sel.value;
    img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
    box.appendChild(img);
    checkCompareReady();
}

function checkCompareReady() {
    const b = document.getElementById('before-select');
    const a = document.getElementById('after-select');
    const btn = document.getElementById('compare-btn');
    if (btn) btn.disabled = !(b && a && b.value && a.value);
}

// Run OpenCV RGB analysis via Flask
async function runRGBAnalysis() {
    const sel = document.getElementById('sample-select');
    if (!sel || !sel.value) return;

    const btn     = document.getElementById('analyze-btn');
    const loading = document.getElementById('analyze-loading');
    const results = document.getElementById('rgb-results');

    btn.disabled = true;
    loading.style.display = 'flex';
    results.style.display = 'none';

    try {
        const res  = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: sel.value })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderRGBResults(data);
    } catch(e) {
        alert('Analysis error: ' + e.message);
    } finally {
        btn.disabled = false;
        loading.style.display = 'none';
    }
}

function renderRGBResults(d) {
    const scoreColor = d.health_score >= 70 ? 'var(--success-green)' :
                       d.health_score >= 40 ? '#f1c40f' : '#e74c3c';

    document.getElementById('r-score').innerText = d.health_score;
    document.getElementById('r-score').style.color = scoreColor;
    document.getElementById('r-grade').innerText = 'GRADE ' + d.health_grade;
    document.getElementById('r-ndvi').innerText  = d.ndvi_proxy.toFixed(2);
    document.getElementById('r-edge').innerText  = 'edges: ' + d.edge_density + '%';

    setBar('bar-veg',  'val-veg',  d.vegetation_pct);
    setBar('bar-bare', 'val-bare', d.bare_pct);
    setBar('bar-burn', 'val-burn', d.burn_pct);

    setRiskBadge('badge-fire',  d.fire_risk);
    setRiskBadge('badge-defor', d.deforestation_risk);

    document.getElementById('rgb-results').style.display = 'block';
}

// Run OpenCV change detection
async function runChangeDetect() {
    const before = document.getElementById('before-select').value;
    const after  = document.getElementById('after-select').value;
    if (!before || !after) return;

    const btn     = document.getElementById('compare-btn');
    const loading = document.getElementById('compare-loading');
    const results = document.getElementById('change-results');

    btn.disabled = true;
    loading.style.display = 'flex';
    results.style.display = 'none';

    try {
        const res  = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ before, after })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        renderChangeResults(data);
    } catch(e) {
        alert('Compare error: ' + e.message);
    } finally {
        btn.disabled = false;
        loading.style.display = 'none';
    }
}

function renderChangeResults(d) {
    document.getElementById('ch-change').innerText  = d.change_pct + '%';
    document.getElementById('ch-regions').innerText = d.change_regions;

    const delta = d.veg_delta;
    const dEl = document.getElementById('ch-veg-delta');
    dEl.innerText = (delta >= 0 ? '+' : '') + delta + '%';
    dEl.style.color = delta >= 0 ? 'var(--success-green)' : '#e74c3c';

    setBar('bar-veg-b', 'val-veg-b', d.veg_before);
    setBar('bar-veg-a', 'val-veg-a', d.veg_after);

    const deforested = d.veg_delta < -10 || d.bare_delta > 10;
    const flagEl = document.getElementById('ch-defor-flag');
    flagEl.innerText = deforested ? '⚠️ YES — Vegetation loss detected' : '✓ Not detected';
    flagEl.style.color = deforested ? '#e74c3c' : 'var(--success-green)';

    const bEl = document.getElementById('ch-bare-delta');
    bEl.innerText = (d.bare_delta >= 0 ? '+' : '') + d.bare_delta + '%';
    bEl.style.color = d.bare_delta > 5 ? '#e74c3c' : '#f1c40f';

    document.getElementById('change-results').style.display = 'block';
}

// Switch between RGB and Change Detection tabs
function switchPayloadTab(tab) {
    document.getElementById('payload-rgb').style.display    = tab === 'rgb'    ? 'block' : 'none';
    document.getElementById('payload-change').style.display = tab === 'change' ? 'block' : 'none';
    document.querySelectorAll('.payload-tabs .chart-btn').forEach((btn, i) => {
        btn.classList.toggle('active', (i === 0 && tab === 'rgb') || (i === 1 && tab === 'change'));
    });
}

// ── HELPERS ──
function setBar(barId, valId, pct) {
    const capped = Math.min(100, pct);
    document.getElementById(barId).style.width = capped + '%';
    document.getElementById(valId).innerText   = pct + '%';
}

function setRiskBadge(id, level) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className  = 'risk-badge risk-' + level;
    el.innerText  = level.toUpperCase();
}

// Auto-load samples when the dashboard page is open
if (document.getElementById('sample-select')) {
    loadSamples();
}