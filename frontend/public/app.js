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