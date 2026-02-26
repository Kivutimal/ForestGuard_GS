console.log("🛰️ ForestGuard GS: Mission Control System Active!");

// 1. Initialize the Map
// We are setting the view to Nairobi coordinates [-1.286, 36.817] 
// The '13' is the zoom level.
const map = L.map('map-container').setView([-1.286, 36.817], 10);

// 2. Add the "Dark Matter" Tile Layer (Perfect for our Space Theme!)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// 3. Add a marker for your Ground Station
const groundStation = L.marker([-1.286, 36.817]).addTo(map);
groundStation.bindPopup("<b>ForestGuard HQ</b><br>Ground Station Alpha").openPopup();

// 4. (Optional) Add a Circle to show your antenna's signal range
const rangeCircle = L.circle([-1.286, 36.817], {
    color: '#66fcf1',      // Neon Cyan
    fillColor: '#66fcf1',
    fillOpacity: 0.1,
    radius: 5000           // 5km radius range
}).addTo(map);