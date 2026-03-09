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

// --- 2. MAP LOGIC (Satellite Hybrid View) ---
const mapElement = document.getElementById('map-container');
if (mapElement) {
    const map = L.map('map-container').setView([-1.286, 36.817], 11);
    const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { pane: 'shadowPane' }).addTo(map);
    L.marker([-1.286, 36.817]).addTo(map).bindPopup("<b>ForestGuard Alpha</b><br>Nairobi HQ").openPopup();
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
                {
                    label: 'RSSI (dBm)',
                    data: [], 
                    borderColor: '#66fcf1', backgroundColor: 'rgba(102, 252, 241, 0.1)', fill: true, tension: 0.4,
                    hidden: false // Visible by default
                },
                {
                    label: 'Battery (%)',
                    data:[], 
                    borderColor: '#00ff00', backgroundColor: 'rgba(0, 255, 0, 0.1)', fill: true, tension: 0.4,
                    hidden: true // Hidden by default
                },
                {
                    label: 'Temp (°C)',
                    data:[], 
                    borderColor: '#ff9900', backgroundColor: 'rgba(255, 153, 0, 0.1)', fill: true, tension: 0.4,
                    hidden: true // Hidden by default
                }
            ]
        },
        options: { 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } }, // Hidden legend because we have buttons now!
            scales: { x: { display: false }, y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } } } 
        }
    });
}

// Global Function to handle Chart Button Clicks
window.showChart = function(index) {
    if (!window.signalChart) return;

    // Toggle datasets
    window.signalChart.data.datasets.forEach((dataset, i) => {
        dataset.hidden = (i !== index);
    });
    window.signalChart.update();

    // Toggle button colors
    const buttons = document.querySelectorAll('.chart-btn');
    buttons.forEach((btn, i) => {
        if (i === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });
};

// --- 4. TERMINAL LOGIC ---
document.querySelectorAll('.cmd-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const log = document.getElementById('terminal-log');
        if (log && !this.classList.contains('chart-btn')) { // Don't log chart clicks
            const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi' });
            log.innerHTML += `> [${time}] EXECUTING: ${this.innerText}...<br>`;
            log.scrollTop = log.scrollHeight;
        }
    });
});

// --- 5. LIVE WEBSOCKET CONNECTION ---
// Make sure this matches your FastAPI server address
const socket = io('http://localhost:8000');

socket.on('connect', () => {
    console.log('🟢 Connected to Python Backend!');
});

socket.on('telemetry_update', (data) => {
    // 1. Update text
    const batEl = document.getElementById('val-battery');
    const tempEl = document.getElementById('val-temp');
    const rssiEl = document.getElementById('val-rssi');

    if (batEl) batEl.innerText = data.battery.toFixed(1) + '%';
    if (tempEl) tempEl.innerText = data.sysTemp.toFixed(1) + '°C';
    if (rssiEl) rssiEl.innerText = data.rssi + ' dBm';

    // 2. Update chart data for ALL lines (even hidden ones)
    if (window.signalChart) {
        const timeNow = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi' });
        
        window.signalChart.data.labels.push(timeNow);
        window.signalChart.data.datasets[0].data.push(data.rssi);
        window.signalChart.data.datasets[1].data.push(data.battery);
        window.signalChart.data.datasets[2].data.push(data.sysTemp);

        if (window.signalChart.data.labels.length > 20) {
            window.signalChart.data.labels.shift();
            window.signalChart.data.datasets[0].data.shift();
            window.signalChart.data.datasets[1].data.shift();
            window.signalChart.data.datasets[2].data.shift();
        }
        window.signalChart.update();
    }
});