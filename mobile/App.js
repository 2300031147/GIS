import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, FlatList, Alert, Modal, TextInput } from 'react-native';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as SQLite from 'expo-sqlite';
import MapView, { Marker } from 'react-native-maps';
import axios from 'axios';

// --- DEFAULT CONFIG (Change in-app settings if on Tailscale) ---
const DEFAULT_API_URL = "http://192.168.4.1:5000"; 

// --- Database ---
const db = SQLite.openDatabase('survey_offline.db');

export default function App() {
  const [hasPermission, setHasPermission] = useState(null);
  const [location, setLocation] = useState(null);
  const [isCameraVisible, setCameraVisible] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [reports, setReports] = useState([]);
  const [isSyncing, setSyncing] = useState(false);
  
  const [currentNotes, setCurrentNotes] = useState("");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const cameraRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status: camStatus } = await Camera.requestCameraPermissionsAsync();
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(camStatus === 'granted' && locStatus === 'granted');

      Location.getCurrentPositionAsync({}).then(loc => setLocation(loc));

      // Setup Local DB
      db.transaction(tx => {
        tx.executeSql(
          'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL, lon REAL, timestamp TEXT, crop_status TEXT, photo_uri TEXT, photo_base64 TEXT, notes TEXT, synced INTEGER DEFAULT 0)'
        );
        loadLocalReports(tx);
      });

      // Fetch Detections from Pi
      fetchDetections();
      const interval = setInterval(fetchDetections, 10000); // Pulse every 10s
      return () => clearInterval(interval);
    })();
  }, []);

  const [piDetections, setPiDetections] = useState([]);

  const fetchDetections = async () => {
    try {
      const res = await axios.get(`${apiUrl}/api/history`);
      setPiDetections(res.data);
    } catch (err) {
      console.log("⚠️ Pi server unreachable for markers");
    }
  };

  const loadLocalReports = (tx) => {
    tx.executeSql('SELECT * FROM reports ORDER BY id DESC', [], (_, { rows }) => {
      setReports(rows._array);
    });
  };

  const takePhoto = async () => {
    if (cameraRef.current) {
      const options = { quality: 0.5, base64: true };
      const data = await cameraRef.current.takePictureAsync(options);
      setPhoto(data.uri);
      setCameraVisible(false);
      saveReport(data.uri, data.base64);
    }
  };

  const saveReport = (uri, b64) => {
    if (!location) {
      return Alert.alert("Wait", "Waiting for GPS lock...");
    }
    
    const timestamp = new Date().toISOString();
    const lat = location.coords.latitude;
    const lon = location.coords.longitude;
    
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO reports (lat, lon, timestamp, crop_status, photo_uri, photo_base64, notes, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [lat, lon, timestamp, 'Field Check', uri, b64, currentNotes, 0],
        () => {
          Alert.alert("Success", "Ground Truth Saved (Offline Enabled)");
          setCurrentNotes(""); // Reset notes
          loadLocalReports(tx);
        }
      );
    });
  };

  const syncData = async () => {
    setSyncing(true);
    const unsynced = reports.filter(r => r.synced === 0);
    
    if (unsynced.length === 0) {
      Alert.alert("Info", "All data is already synced.");
      setSyncing(false);
      return;
    }

    try {
      for (const item of unsynced) {
        await axios.post(`${apiUrl}/gis/survey/data`, {
          drone_id: "field-officer-mobile",
          lat: item.lat,
          lon: item.lon,
          crop_status: "verified",
          crop_type: "Inspection",
          confidence: 1.0,
          image_base64: item.photo_base64,
          notes: item.notes
        });
        
        db.transaction(tx => {
          tx.executeSql('UPDATE reports SET synced = 1 WHERE id = ?', [item.id]);
        });
        // Update UI list for this item immediately
        loadLocalReports(db); 
      }
      Alert.alert("Sync Complete", `Successfully uploaded ${unsynced.length} reports.`);
      db.transaction(loadLocalReports);
    } catch (error) {
      Alert.alert("Sync Failed", "Could not reach the Pi server.");
    } finally {
      setSyncing(false);
    }
  };

  if (hasPermission === null) return <View />;
  if (hasPermission === false) return <Text>No access to camera/location</Text>;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setSettingsVisible(true)}>
          <Text style={{ color: 'white', fontSize: 18 }}>⚙️</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>National Crop Surveyor</Text>
        <TouchableOpacity onPress={syncData} disabled={isSyncing}>
          <Text style={[styles.syncButton, isSyncing && { opacity: 0.5 }]}>
            {isSyncing ? "Syncing..." : "🔄 SYNC"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Settings Modal */}
      <Modal visible={isSettingsVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.settingsBox}>
            <Text style={styles.settingsTitle}>Tailscale / Network Config</Text>
            <TextInput 
              style={styles.settingsInput} 
              value={apiUrl} 
              onChangeText={setApiUrl} 
              placeholder="http://100.x.y.z:5000"
            />
            <TouchableOpacity style={styles.settingsButton} onPress={() => setSettingsVisible(false)}>
              <Text style={{ color: 'white', fontWeight: '900' }}>SAVE IP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Map View */}
      {location && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }}
          showsUserLocation
        >
          {reports.map((r, i) => (
            <Marker
              key={`rep-${i}`}
              coordinate={{ latitude: r.lat, longitude: r.lon }}
              pinColor={r.synced ? "green" : "orange"}
              title={`Verification ${r.id}`}
              description={r.crop_status}
            />
          ))}
          {piDetections.map((d, i) => (
            <Marker
              key={`pi-${i}`}
              coordinate={{ latitude: d.lat, longitude: d.lon }}
              pinColor={d.crop_status === 'healthy' ? 'green' : d.crop_status === 'diseased' ? 'red' : 'yellow'}
              title={`AI: ${d.crop_type}`}
              description={d.crop_status}
            />
          ))}

        </MapView>
      )}

      {/* Capture Button */}
      <TouchableOpacity style={styles.captureButton} onPress={() => setCameraVisible(true)}>
        <Text style={styles.captureText}>📸 LOG GROUND TRUTH</Text>
      </TouchableOpacity>

      {/* Camera Modal */}
      <Modal visible={isCameraVisible} animationType="slide">
        <Camera style={{ flex: 1 }} ref={cameraRef}>
          <View style={styles.cameraFrame}>
            <TouchableOpacity style={styles.closeCamera} onPress={() => setCameraVisible(false)}>
              <Text style={{ color: 'white', fontSize: 20 }}>✕</Text>
            </TouchableOpacity>
            
            <View style={styles.notesContainer}>
              <TextInput 
                placeholder="Add Ground Observation..." 
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={styles.notesInput}
                value={currentNotes}
                onChangeText={setCurrentNotes}
              />
            </View>

            <TouchableOpacity style={styles.takePicButton} onPress={takePhoto}>
              <View style={styles.outerCircle}>
                <View style={styles.innerCircle} />
              </View>
            </TouchableOpacity>
          </View>
        </Camera>
      </Modal>

      {/* List of Local Records */}
      <View style={styles.reportsSection}>
        <Text style={styles.sectionTitle}>Local Ground Log (Offline)</Text>
        <FlatList
          data={reports}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.reportItem}>
               <Text style={styles.reportText}>📍 {item.lat.toFixed(4)}, {item.lon.toFixed(4)}</Text>
               <Text style={[styles.reportStatus, { color: item.synced ? '#2ecc71' : '#f39c12' }]}>
                 {item.synced ? "UPLINKED" : "QUEUED"}
               </Text>
            </View>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: { 
    height: 100, paddingTop: 50, paddingHorizontal: 20, 
    backgroundColor: '#0f172a', flexDirection: 'row', justifyContent: 'space-between' 
  },
  headerTitle: { color: 'white', fontSize: 16, fontWeight: '900', letterSpacing: -0.5, textTransform: 'uppercase' },
  syncButton: { color: '#10b981', fontWeight: '900', fontSize: 12 },
  map: { height: 350, width: '100%' },
  captureButton: { 
    backgroundColor: '#0f172a', margin: 20, padding: 20, 
    borderRadius: 12, alignItems: 'center', shadowColor: '#10b981', 
    shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)'
  },
  captureText: { color: '#10b981', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  reportsSection: { flex: 1, padding: 20 },
  sectionTitle: { fontSize: 10, fontWeight: '900', color: '#ccc', marginBottom: 15, textTransform: 'uppercase', letterSpacing: 2 },
  reportItem: { 
    backgroundColor: 'white', padding: 15, borderRadius: 4, 
    marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#f0f0f0'
  },
  reportText: { fontSize: 12, color: '#333', fontWeight: 'bold' },
  reportStatus: { fontSize: 10, fontWeight: '900' },
  cameraFrame: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60 },
  notesContainer: { 
    width: '80%', backgroundColor: 'rgba(0,0,0,0.6)', 
    borderRadius: 8, padding: 10, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  notesInput: { color: 'white', fontSize: 13, fontWeight: 'bold' },
  takePicButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  outerCircle: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, borderColor: 'white', justifyContent: 'center', alignItems: 'center' },
  innerCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'white' },
  closeCamera: { position: 'absolute', top: 50, right: 30, backgroundColor: 'rgba(0,0,0,0.8)', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  settingsBox: { backgroundColor: '#0f172a', padding: 25, borderRadius: 15, width: '80%', borderWidth: 1, borderColor: '#10b981' },
  settingsTitle: { color: 'white', fontSize: 12, fontWeight: '900', marginBottom: 15, textTransform: 'uppercase', letterSpacing: 1 },
  settingsInput: { backgroundColor: 'rgba(255,255,255,0.05)', color: 'white', padding: 15, borderRadius: 8, marginBottom: 15, fontSize: 13, borderBottomWidth: 2, borderBottomColor: '#10b981' },
  settingsButton: { backgroundColor: '#10b981', padding: 15, borderRadius: 8, alignItems: 'center' }
});
