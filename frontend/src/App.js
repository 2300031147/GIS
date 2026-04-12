import { motion, AnimatePresence } from 'framer-motion';

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
const IP_ADDRESS = window.location.hostname || "192.168.4.1"; 
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

// --- UI Components (Professional Refactor) ---
const Card = ({ children, title, className = "", icon }) => (
    <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`glass-surface rounded-xl overflow-hidden mb-4 ${className}`}
    >
        {title && (
            <div className="panel-header px-4 py-3 flex items-center justify-between">
                <h3 className="uppercase-label flex items-center gap-2">
                    {icon}
                    {title}
                </h3>
            </div>
        )}
        <div className="p-4">
            {children}
        </div>
    </motion.div>
);

const Button = ({ children, onClick, variant = "primary", className = "", disabled = false }) => {
    const variants = {
        primary: "bg-emerald-600/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/20",
        secondary: "bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10",
        danger: "bg-rose-600/10 text-rose-400 border border-rose-500/30 hover:bg-rose-600/20",
        success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-500/20",
        warning: "bg-amber-600/10 text-amber-400 border border-amber-500/30 hover:bg-amber-600/20"
    };
    
    return (
        <motion.button 
            whileHover={!disabled ? { scale: 1.02, translateY: -1 } : {}}
            whileTap={!disabled ? { scale: 0.98 } : {}}
            onClick={onClick} 
            disabled={disabled}
            className={`px-3 py-2 rounded-lg text-[11px] font-bold uppercase transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
        >
            {children}
        </motion.button>
    );
};

const RcSlider = ({ label, val, setVal }) => (
    <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
            <span className="uppercase-label">{label}</span>
            <span className="font-mono text-[11px] text-emerald-400">{val}m</span>
        </div>
        <input 
            type="range" min="1000" max="2000" step="10" 
            value={val} onChange={(e) => setVal(e.target.value)} 
            className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
        />
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
    const [flightMode, setFlightMode] = useState('LOITER');
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
        <div className="flex h-screen w-screen overflow-hidden bg-[#05070a] font-sans text-slate-100">
            {/* Sidebar Container */}
            <aside className="w-80 flex-shrink-0 border-r border-white/5 bg-[#0a0c10] flex flex-col z-20 shadow-2xl">
                {/* Brand Header */}
                <div className="p-6 border-b border-white/5 bg-[#11141b]/50 backdrop-blur-md flex justify-between items-center">
                    <div className="flex flex-col">
                        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                             <div className="w-2 h-6 bg-emerald-500 rounded-sm"></div>
                             GIS <span className="font-light text-slate-400">CONTROL</span>
                        </h1>
                        <span className="text-[9px] font-mono text-emerald-500/50 mt-1 uppercase tracking-widest">Autonomous Survey Protocol</span>
                    </div>
                </div>

                {/* Sidebar Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                    {/* Telemetry Card */}
                    <Card title="Telemetry Link" icon={<span className="text-blue-400">⚡</span>}>
                        <div className="p-4 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden">
                            <div className="flex justify-between items-start mb-6">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`status-point ${Date.now() - (scout.lastHeartbeat || 0) < 3000 ? 'bg-emerald-500 status-glow-emerald' : 'bg-rose-500'}`}></div>
                                        <span className="font-mono-data text-[11px] font-bold text-slate-200">SCOUT_UNIT_01</span>
                                    </div>
                                    <div className="text-[9px] text-slate-500 font-mono tracking-tighter uppercase">ID: 4X-99 ALPHA</div>
                                </div>
                                <div className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${scout.status === 'ARMED' ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' : 'border-white/10 text-slate-500 bg-white/5'}`}>
                                    {scout.status}
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <div className="flex justify-between items-end">
                                        <span className="uppercase-label !text-[8px]">Mission Execution</span>
                                        <span className="font-mono-data text-xs text-emerald-400">{missionProgress}%</span>
                                    </div>
                                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                        <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${missionProgress}%` }}
                                            className="h-full bg-emerald-500 relative"
                                        >
                                            <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                        </motion.div>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="uppercase-label !text-[8px]">Propulsion</div>
                                        <div className="font-mono-data text-xs text-slate-200">{scout.speed ? scout.speed.toFixed(1) : 0} <span className="text-[8px] opacity-40">m/s</span></div>
                                    </div>
                                    <div>
                                        <div className="uppercase-label !text-[8px]">Altitude</div>
                                        <div className="font-mono-data text-xs text-slate-200">{scout.alt ? scout.alt.toFixed(1) : 0} <span className="text-[8px] opacity-40">m</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Mission Core Card */}
                    <Card title="Mission Sequence" icon={<span className="text-amber-400">✦</span>}>
                        <div className="space-y-3">
                            <RcSlider label="Target altitude" val={takeoffAlt} setVal={setTakeoffAlt} />
                            <div className="grid grid-cols-2 gap-2">
                                <Button variant="success" onClick={() => sendCommand('arm')}>Initiate Arm</Button>
                                <Button variant="primary" onClick={() => sendCommand('takeoff', { alt: takeoffAlt })}>Takeoff</Button>
                                <Button className="col-span-2 !bg-rose-500/10 !text-rose-400 !border-rose-500/30 hover:!bg-rose-500/20" onClick={() => sendCommand('land')}>Immediate Land</Button>
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                                <select 
                                    value={flightMode} 
                                    onChange={(e) => setFlightMode(e.target.value)}
                                    className="flex-1 text-[11px] font-bold bg-white/5 border border-white/10 rounded-lg px-3 outline-none uppercase h-9 text-slate-300 focus:border-emerald-500/50"
                                >
                                    <option value="STABILIZE">STABILIZE</option>
                                    <option value="LOITER">LOITER</option>
                                    <option value="AUTO">AUTO MISSION</option>
                                    <option value="RTL">RETURN HOME</option>
                                </select>
                                <Button variant="secondary" className="h-9 px-4" onClick={() => sendCommand('set_mode', { mode: flightMode })}>Set</Button>
                            </div>
                        </div>
                    </Card>

                    {/* Planning Card */}
                    <Card title="Strategy Engine" icon={<span className="text-emerald-400">▣</span>}>
                        <div className="flex gap-2 mb-3 bg-white/5 p-1 rounded-lg border border-white/5">
                            <button 
                                onClick={() => setDrawMode('mission')} 
                                className={`flex-1 py-2 text-[9px] font-bold uppercase rounded-md transition-all ${drawMode === 'mission' ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                Waypoints
                            </button>
                            <button 
                                onClick={() => setDrawMode('area')} 
                                className={`flex-1 py-2 text-[9px] font-bold uppercase rounded-md transition-all ${drawMode === 'area' ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                Area Grid
                            </button>
                        </div>
                        {drawMode === 'area' ? (
                            <Button variant="success" onClick={generatePath} className="w-full">Initialize Path Compute</Button>
                        ) : (
                            <div className="space-y-2">
                                <Button variant="primary" onClick={uploadMission} className="w-full">Sync Flight Pattern</Button>
                                <label className="block w-full group">
                                    <div className="text-center py-2 px-4 border border-dashed border-white/10 rounded-lg cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all">
                                        <span className="text-[10px] uppercase font-bold text-slate-500 group-hover:text-emerald-400">Import KML Registry</span>
                                        <input type="file" accept=".kml" className="hidden" onChange={handleKMLUpload} />
                                    </div>
                                </label>
                            </div>
                        )}
                    </Card>

                    {/* Analytics Card */}
                    <Card title="Data Intelligence" icon={<span className="text-blue-400">◈</span>}>
                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                                <div className="uppercase-label !text-[7px] mb-1">Signal Hits</div>
                                <div className="text-xl font-bold font-mono-data">{analytics.total_detections}</div>
                            </div>
                            <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                                <div className="uppercase-label !text-[7px] mb-1">Scan Yield</div>
                                <div className="text-xl font-bold font-mono-data text-emerald-400">{analytics.acres_scanned.toFixed(2)}ac</div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {Object.entries(analytics.distribution).map(([status, count]) => (
                                <div key={status} className="flex justify-between items-center text-[10px] font-mono-data py-1.5 px-2 rounded bg-white/2 border border-white/5">
                                    <span className="text-slate-500 uppercase">{status}</span>
                                    <span className={`font-bold ${status === 'healthy' ? 'text-emerald-500' : 'text-rose-500'}`}>{count}</span>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Log Card */}
                    <Card title="Incident Protocol" icon={<span className="text-rose-400">▤</span>}>
                        <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                            <AnimatePresence mode="popLayout">
                                {detections.length === 0 && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-slate-600 py-6 italic text-[10px]">
                                        Listening for telemetric events...
                                    </motion.div>
                                )}
                                {detections.map((d, i) => (
                                    <motion.div 
                                        key={d.id || i} 
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="p-3 bg-white/2 rounded-lg border border-white/5 flex flex-col gap-1 transition-all hover:border-white/20"
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className="font-bold text-[10px] text-slate-200 uppercase tracking-tight">{d.crop_type}</span>
                                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${d.crop_status === 'healthy' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}`}>
                                                {d.crop_status.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="font-mono text-[9px] text-slate-500">{d.lat.toFixed(6)}, {d.lon.toFixed(6)}</div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </Card>
                </div>
            </aside>

            {/* Main Section */}
            <main className="flex-1 relative overflow-hidden bg-[#0a0c10]">
                <MapContainer center={[16.5062, 80.6480]} zoom={18} zoomControl={false} style={{ height: "100%", width: "100%" }}>
                    <TileLayer 
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
                    />
                    <MapClicker addWaypoint={handleMapClick} mode={drawMode} />
                    <DroneTracker position={scout} followMode={followMode} />
                    
                    {waypoints.map((wp, i) => <Marker key={i} position={wp} icon={scoutIcon} opacity={0.4} />)}
                    <Polyline positions={waypoints} color="#10b981" weight={1.5} dashArray="8, 12" />
                    {polygonPoints.length > 0 && <Polygon positions={polygonPoints} color="#f59e0b" weight={1} fillOpacity={0.03} />}
                    
                    <Marker position={[scout.lat, scout.lon]} icon={scoutIcon}>
                        <Popup>
                            <div className="p-2 space-y-2">
                                <div className="text-[10px] font-bold text-slate-400 uppercase">Unit: Scout_01</div>
                                <div className="text-xs font-mono font-bold text-emerald-400">LAT: {scout.lat.toFixed(6)}</div>
                                <div className="text-xs font-mono font-bold text-emerald-400">LON: {scout.lon.toFixed(6)}</div>
                            </div>
                        </Popup>
                    </Marker>
                    
                    {detections.map((d, i) => (
                        <Marker key={d.id || i} position={[d.lat, d.lon]} icon={d.crop_status === 'healthy' ? healthyIcon : d.crop_status === 'diseased' ? diseasedIcon : weedIcon}>
                            <Popup>
                                <div className="p-2 space-y-1">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{d.crop_type}</div>
                                    <div className={`text-sm font-bold ${d.crop_status === 'healthy' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {d.crop_status.toUpperCase()}
                                    </div>
                                    <div className="pt-2 border-t border-white/10 flex justify-between items-center gap-4">
                                        <span className="text-[9px] text-slate-500">Confidence</span>
                                        <span className="text-[10px] font-mono font-bold">{(d.confidence*100).toFixed(1)}%</span>
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    ))}
                </MapContainer>

                {/* Tactical Overlays */}
                <div className="absolute top-6 left-6 z-[1000] flex gap-4">
                    <button 
                         onClick={() => setFollowMode(!followMode)}
                         className={`px-4 py-2 border rounded-full text-[10px] font-bold uppercase transition-all flex items-center gap-2 backdrop-blur-xl ${followMode ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20' : 'bg-black/60 border-white/10 text-slate-400'}`}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full ${followMode ? 'bg-white animate-pulse' : 'bg-slate-500'}`}></div>
                        Auto-Track {followMode ? 'ON' : 'OFF'}
                    </button>
                    
                    <div className="bg-black/80 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full text-[10px] font-bold text-slate-400 flex items-center gap-3">
                         <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-emerald-500 rounded-full"></div> SAT_LINK</span>
                         <div className="w-px h-3 bg-white/10"></div>
                         <span className="font-mono text-emerald-500/80 uppercase">AES_SECURE</span>
                    </div>
                </div>

                <div className="absolute bottom-10 right-10 z-[1000]">
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-[#0f172a]/90 backdrop-blur-2xl px-8 py-6 rounded-3xl border border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] min-w-[320px]"
                    >
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400 tracking-[0.2em] uppercase">
                                <div className="w-2 h-2 bg-emerald-500 rounded-sm"></div>
                                Tactical HUD
                            </div>
                            <div className="text-[8px] font-mono text-slate-500">REF_ID: CR19-Z</div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                            <div className="space-y-1">
                                <div className="uppercase-label !text-[8px] flex items-center gap-1.5">
                                     <div className="w-1 h-1 bg-blue-500 rounded-full"></div> Latitude
                                </div>
                                <div className="text-xl font-mono-data font-bold text-slate-100 tracking-tighter">
                                    {scout.lat.toFixed(7)}°
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="uppercase-label !text-[8px] flex items-center gap-1.5">
                                     <div className="w-1 h-1 bg-blue-500 rounded-full"></div> Longitude
                                </div>
                                <div className="text-xl font-mono-data font-bold text-slate-100 tracking-tighter">
                                    {scout.lon.toFixed(7)}°
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-8 pt-6 border-t border-white/5 flex justify-between items-center">
                            <div className="flex flex-col">
                                <span className="text-[8px] text-slate-500 uppercase font-bold">System Uptime</span>
                                <span className="text-[10px] font-mono-data font-bold text-emerald-500/80">{(performance.now()/1000).toFixed(0)} <span className="text-[8px]">SECONDS</span></span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[8px] text-slate-500 uppercase font-bold">Signal Status</span>
                                <span className="text-[10px] font-mono-data font-bold text-emerald-500/80 animate-pulse">OPTIMAL</span>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </main>
        </div>
    );
}

export default App;
