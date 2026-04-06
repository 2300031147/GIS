import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, Polyline, Polygon } from 'react-leaflet';
import axios from 'axios';
import io from 'socket.io-client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// --- Icons ---
const scoutIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const healthyIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
    iconSize: [20, 32], iconAnchor: [10, 32], popupAnchor: [1, -28],
});
const diseasedIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
    iconSize: [20, 32], iconAnchor: [10, 32], popupAnchor: [1, -28],
});
const weedIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-gold.png',
    iconSize: [20, 32], iconAnchor: [10, 32], popupAnchor: [1, -28],
});

// --- Config ---
const IP_ADDRESS = "192.168.4.1"; // Pi's Hotspot IP
const socket = io(`http://${IP_ADDRESS}:5000`);

// --- Helpers ---
function isPointInPoly(pt, vs) {
    var x = pt.lat, y = pt.lng;
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i].lat, yi = vs[i].lng;
        var xj = vs[j].lat, yj = vs[j].lng;
        var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function generateGrid(polyPoints) {
    if (polyPoints.length < 3) return [];
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    polyPoints.forEach(p => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLon) minLon = p.lng;
        if (p.lng > maxLon) maxLon = p.lng;
    });
    const step = 0.00015;
    let grid = [];
    let latSteps = Math.ceil((maxLat - minLat) / step);
    let lonSteps = Math.ceil((maxLon - minLon) / step);
    for (let i = 0; i <= latSteps; i++) {
        let currentLat = minLat + (i * step);
        let row = [];
        for (let j = 0; j <= lonSteps; j++) {
            let currentLon = minLon + (j * step);
            if (isPointInPoly({ lat: currentLat, lng: currentLon }, polyPoints)) {
                row.push({ lat: currentLat, lng: currentLon });
            }
        }
        if (i % 2 === 1) row.reverse();
        grid.push(...row);
    }
    return grid;
}

// --- UI Components ---
const Card = ({ children, title, className = "" }) => (
    <div className={`bg-white p-4 rounded-lg shadow-sm border border-slate-200 ${className}`}>
        {title && <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-50 pb-1">{title}</h3>}
        {children}
    </div>
);

const Button = ({ children, onClick, variant = "primary", className = "" }) => {
    const variants = {
        primary: "bg-slate-900 text-white hover:bg-slate-800",
        secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
        danger: "bg-red-600 text-white hover:bg-red-700",
        success: "bg-emerald-600 text-white hover:bg-emerald-700",
        warning: "bg-amber-500 text-white hover:bg-amber-600"
    };
    return (
        <button onClick={onClick} className={`px-4 py-2 rounded-md text-[10px] font-bold uppercase transition-all active:scale-95 ${variants[variant]} ${className}`}>
            {children}
        </button>
    );
};

const RcSlider = ({ label, val, setVal }) => (
    <div className="flex items-center gap-2">
        <span className="text-[10px] w-12 font-mono text-slate-500">{label}</span>
        <input type="range" min="1000" max="2000" step="10" value={val} onChange={(e) => setVal(e.target.value)} className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
        <span className="text-[10px] w-8 font-mono">{val}</span>
    </div>
);

function MapClicker({ addWaypoint, mode }) {
    useMapEvents({ click(e) { addWaypoint(e.latlng); } });
    return null;
}

function DroneTracker({ position, followMode }) {
    const map = useMap();
    useEffect(() => {
        if (followMode && position.lat !== 0 && position.lat !== 16.506) {
            map.setView([position.lat, position.lon], map.getZoom(), { animate: true });
        }
    }, [position, followMode, map]);
    return null;
}

function App() {
    const [waypoints, setWaypoints] = useState([]); 
    const [polygonPoints, setPolygonPoints] = useState([]); 
    const [drawMode, setDrawMode] = useState('mission'); 
    const [scout, setScout] = useState({ lat: 16.506, lon: 80.648, alt: 0, bat: 0, gps_sats: 0, status: "OFFLINE", speed: 0, mode: "UNKNOWN" });
    const [followMode, setFollowMode] = useState(true);
    const [takeoffAlt, setTakeoffAlt] = useState(10);
    const [missionProgress, setMissionProgress] = useState(0);
    const [detections, setDetections] = useState([]);
    const [analytics, setAnalytics] = useState({ total_detections: 0, acres_scanned: 0, distribution: {} });
    const [rcChannels, setRcChannels] = useState([1500, 1500, 1000, 1500, 0, 0, 0, 0]);

    const updateRc = (idx, val) => {
        const newCh = [...rcChannels];
        newCh[idx] = parseInt(val);
        setRcChannels(newCh);
    };

    const sendRcOverride = () => sendCommand('rc_override', { channels: rcChannels });
    const releaseRc = () => { setRcChannels([1500, 1500, 1000, 1500, 0, 0, 0, 0]); sendCommand('rc_override', { channels: [0, 0, 0, 0, 0, 0, 0, 0] }); };

    useEffect(() => {
        socket.on('telemetry_update', (msg) => {
            if (msg.current_wp !== undefined && msg.total_wp > 0) setMissionProgress(Math.round((msg.current_wp / msg.total_wp) * 100));
            if (msg.drone === 'scout') setScout({ ...msg.data, lastHeartbeat: Date.now() });
        });
        socket.on('survey_update', (msg) => { setDetections(prev => [msg, ...prev].slice(0, 100)); fetchAnalytics(); });
        fetchHistory(); fetchAnalytics();
        return () => { socket.off('telemetry_update'); socket.off('survey_update'); };
    }, []);

    const fetchHistory = () => { axios.get(`http://${IP_ADDRESS}:5000/api/history`).then(res => setDetections(res.data)).catch(e => console.error(e)); };
    const fetchAnalytics = () => { axios.get(`http://${IP_ADDRESS}:5000/api/analytics`).then(res => setAnalytics(res.data)).catch(e => console.error(e)); };
    const sendCommand = (cmd, payload = {}) => { axios.post(`http://${IP_ADDRESS}:5000/${cmd}`, payload).then(() => console.log(`✅ ${cmd} Sent`)).catch(() => alert("❌ Backend Error")); };
    const uploadMission = () => { if (waypoints.length === 0) return alert("Select waypoints!"); axios.post(`http://${IP_ADDRESS}:5000/upload_mission`, { waypoints }).then(() => alert("🚀 Mission Deployed!")).catch(() => alert("❌ Fail")); };

    const handleKMLUpload = (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const xmlDoc = new DOMParser().parseFromString(e.target.result, "text/xml");
                const coords = xmlDoc.getElementsByTagName("coordinates");
                const newPoints = [];
                for (let i = 0; i < coords.length; i++) {
                    coords[i].textContent.trim().split(/\s+/).forEach(pair => {
                        const [lng, lat] = pair.split(',').map(Number);
                        if (!isNaN(lat) && !isNaN(lng)) newPoints.push({ lat, lng });
                    });
                }
                if (newPoints.length > 0) { setWaypoints(newPoints); alert(`✅ Imported ${newPoints.length} Points`); }
            } catch (err) { alert("❌ KML Error"); }
        };
        reader.readAsText(file);
    };

    const handleMapClick = (latlng) => { if (drawMode === 'mission') setWaypoints([...waypoints, latlng]); else if (drawMode === 'area') setPolygonPoints([...polygonPoints, latlng]); };
    const generatePath = () => { if (polygonPoints.length < 3) return alert("Define area first!"); setWaypoints(generateGrid(polygonPoints)); setDrawMode('mission'); };

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
            <aside className="w-80 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col z-10 shadow-2xl">
                <div className="p-6 border-b border-slate-100 bg-slate-900 text-white flex justify-between items-baseline">
                    <h1 className="text-xl font-black tracking-tighter uppercase italic">GIS <span className="text-emerald-400">Scan</span></h1>
                    <span className="text-[9px] font-bold opacity-50">v4.2.0-PRO</span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <Card title="UAV Telemetry">
                        <div className="p-3 rounded-lg bg-slate-900 text-white border border-slate-800 shadow-inner">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${Date.now() - (scout.lastHeartbeat || 0) < 3000 ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}></div>
                                    <span className="text-[10px] font-black uppercase tracking-widest">Scout-01 Unit</span>
                                </div>
                                <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${scout.status === 'ARMED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-slate-400'}`}>{scout.status}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div><div className="text-[8px] text-slate-500 uppercase font-black">Altitude</div><div className="text-sm font-mono font-bold text-emerald-400">{scout.alt.toFixed(1)}m</div></div>
                                <div><div className="text-[8px] text-slate-500 uppercase font-black">Speed</div><div className="text-sm font-mono font-bold">{scout.speed}m/s</div></div>
                                <div><div className="text-[8px] text-slate-500 uppercase font-black">Battery</div><div className="text-sm font-mono font-bold">{scout.bat}%</div></div>
                                <div><div className="text-[8px] text-slate-500 uppercase font-black">GNSS</div><div className="text-sm font-mono font-bold text-sky-400">{scout.gps_sats} SATS</div></div>
                            </div>
                        </div>
                    </Card>

                    <Card title="Mission Control">
                        <div className="grid grid-cols-3 gap-2 mb-4">
                            <Button variant="success" onClick={() => sendCommand('arm')}>ARM</Button>
                            <Button variant="warning" onClick={() => sendCommand('disarm')}>KILL</Button>
                            <Button variant="danger" onClick={() => sendCommand('land')}>LAND</Button>
                        </div>
                        <div className="flex gap-2">
                            <select id="mode-select" className="flex-1 text-[10px] font-bold bg-slate-50 border border-slate-200 rounded px-2 outline-none uppercase h-8">
                                <option value="STABILIZE">STABILIZE</option>
                                <option value="LOITER">LOITER</option>
                                <option value="AUTO">AUTO MISSION</option>
                                <option value="RTL">RETURN HOME</option>
                            </select>
                            <Button variant="secondary" className="h-8" onClick={() => sendCommand('set_mode', { mode: document.getElementById('mode-select').value })}>SET</Button>
                        </div>
                    </Card>

                    <Card title="Strategic Planner">
                        <div className="flex gap-2 mb-3">
                            <Button variant={drawMode === 'mission' ? 'primary' : 'secondary'} onClick={() => setDrawMode('mission')} className="flex-1">Waypoints</Button>
                            <Button variant={drawMode === 'area' ? 'warning' : 'secondary'} onClick={() => setDrawMode('area')} className="flex-1">Polygon</Button>
                        </div>
                        {drawMode === 'area' ? (
                            <Button variant="primary" onClick={generatePath} className="w-full">Generate Scan Grid</Button>
                        ) : (
                            <div className="space-y-2">
                                <Button variant="success" onClick={uploadMission} className="w-full italic">📡 Deployed Points</Button>
                                <label className="block w-full text-center p-2 border border-dashed border-slate-300 rounded cursor-pointer hover:bg-slate-50 transition-colors">
                                    <span className="text-[9px] font-black uppercase text-slate-400">Import KML File</span>
                                    <input type="file" accept=".kml" className="hidden" onChange={handleKMLUpload} />
                                </label>
                            </div>
                        )}
                    </Card>

                    <Card title="Intelligence Analytics">
                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-slate-50 p-3 rounded-lg text-center border border-slate-100">
                                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Detections</div>
                                <div className="text-2xl font-black">{analytics.total_detections}</div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg text-center border border-slate-100">
                                <div className="text-[8px] font-black text-slate-400 uppercase mb-1">Coverage</div>
                                <div className="text-2xl font-black text-emerald-600">{analytics.acres_scanned.toFixed(2)}ac</div>
                            </div>
                        </div>
                        <div className="space-y-1 px-1">
                            {Object.entries(analytics.distribution).map(([status, count]) => (
                                <div key={status} className="flex justify-between items-center text-[10px] font-bold uppercase py-1 border-b border-slate-50 last:border-0">
                                    <span className="text-slate-400">{status}</span>
                                    <span className={status === 'healthy' ? 'text-emerald-500' : 'text-rose-500'}>{count}</span>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card title="Tactical Incident Log">
                        <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar text-[9px]">
                            {detections.length === 0 && <div className="text-center text-slate-400 py-4 italic">Scanning for anomalies...</div>}
                            {detections.map((d, i) => (
                                <div key={d.id || i} className="p-2 bg-slate-50 rounded border border-slate-200 flex flex-col gap-1">
                                    <div className="flex justify-between font-black uppercase tracking-tighter">
                                        <span>{d.crop_type}</span>
                                        <span className={d.crop_status === 'healthy' ? 'text-emerald-600' : 'text-rose-600'}>{d.crop_status}</span>
                                    </div>
                                    <div className="font-mono text-slate-400">{d.lat.toFixed(6)}, {d.lon.toFixed(6)}</div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </aside>

            <main className="flex-1 relative">
                <MapContainer center={[16.5062, 80.6480]} zoom={18} zoomControl={false} style={{ height: "100%", width: "100%" }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; National GIS" />
                    <MapClicker addWaypoint={handleMapClick} mode={drawMode} />
                    <DroneTracker position={scout} followMode={followMode} />
                    
                    {waypoints.map((wp, i) => <Marker key={i} position={wp} icon={scoutIcon} opacity={0.4} />)}
                    <Polyline positions={waypoints} color="#10b981" weight={2} dashArray="5, 10" />
                    {polygonPoints.length > 0 && <Polygon positions={polygonPoints} color="#f59e0b" weight={1} fillOpacity={0.05} />}
                    
                    <Marker position={[scout.lat, scout.lon]} icon={scoutIcon}><Popup><span className="font-black italic">UAV_ACTIVE</span></Popup></Marker>
                    
                    {detections.map((d, i) => (
                        <Marker key={d.id || i} position={[d.lat, d.lon]} icon={d.crop_status === 'healthy' ? healthyIcon : d.crop_status === 'diseased' ? diseasedIcon : weedIcon}>
                            <Popup>
                                <div className="font-black text-[10px] uppercase">
                                    <div className="text-slate-400">{d.crop_type}</div>
                                    <div className={d.crop_status === 'healthy' ? 'text-emerald-500' : 'text-rose-500'}>{d.crop_status}</div>
                                    <div className="mt-2 pt-1 border-t border-slate-100 text-[8px]">Confidence: {(d.confidence*100).toFixed(1)}%</div>
                                </div>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>

                <div className="absolute top-4 right-4 bg-slate-900 border border-slate-800 text-white px-5 py-3 rounded shadow-2xl z-[1000] font-mono text-[10px] flex flex-col gap-1">
                    <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div><span>SAT_COMM_LINK: ACTIVE</span></div>
                    <div className="opacity-40">ENCRYPTION: AES-256-GCM</div>
                </div>

                <div className="absolute bottom-8 left-8 bg-white/95 backdrop-blur-lg px-5 py-4 rounded-2xl shadow-2xl z-[1000] border border-slate-200 min-w-[240px]">
                    <div className="text-[8px] font-black text-slate-300 uppercase tracking-widest mb-2 border-b border-slate-50 pb-1">Navigation HUD</div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><div className="text-[8px] font-black text-slate-400 uppercase">LAT</div><div className="text-xs font-mono font-bold">{scout.lat.toFixed(6)}°N</div></div>
                        <div><div className="text-[8px] font-black text-slate-400 uppercase">LON</div><div className="text-xs font-mono font-bold">{scout.lon.toFixed(6)}°E</div></div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
