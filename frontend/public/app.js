// --- 1. KENYA TIME CLOCK (EAT) ---
function updateClock() {
    const clockElement = document.getElementById('mission-clock');
    if (clockElement) {
        const now = new Date();
        // Displays time in Nairobi, Kenya timezone
        const nairobiTime = now.toLocaleTimeString('en-GB', { 
            timeZone: 'Africa/Nairobi',
            hour12: false 
        });
        clockElement.innerText = `EAT: ${nairobiTime}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

// --- 2. MAP LOGIC (Satellite Hybrid View) ---
const mapElement = document.getElementById('map-container');
if (mapElement) {
    // 1. Initialize map centered on Nairobi
    const map = L.map('map-container').setView([-1.286, 36.817], 11);

    // 2. Add high-quality Satellite Imagery
    const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }).addTo(map);

    // 3. Add a semi-transparent dark overlay so it still matches the space theme
    // This keeps the satellite view from being TOO bright and distracting
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        pane: 'shadowPane', // Puts labels on top
    }).addTo(map);

    // 4. Add a custom glowing marker for your Ground Station
    L.marker([-1.286, 36.817]).addTo(map)
        .bindPopup("<b>ForestGuard Alpha</b><br>Nairobi HQ")
        .openPopup();
}

// --- 3. CHART LOGIC ---
const chartElement = document.getElementById('chart-container');
if (chartElement) {
    const ctx = document.createElement('canvas');
    chartElement.appendChild(ctx);
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['-60s', '-40s', '-20s', 'Now'],
            datasets: [{
                label: 'RSSI (Signal)',
                data: [-95, -88, -84, -85],
                borderColor: '#66fcf1',
                tension: 0.4
            }]
        },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// --- 4. TERMINAL LOGIC ---
document.querySelectorAll('.cmd-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const log = document.getElementById('terminal-log');
        if (log) {
            const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Nairobi' });
            log.innerHTML += `> [${time}] EXECUTING: ${this.innerText}...<br>`;
            log.scrollTop = log.scrollHeight;
        }
    });
});