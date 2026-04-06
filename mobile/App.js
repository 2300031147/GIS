import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, FlatList, Alert, Modal, TextInput } from 'react-native';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as SQLite from 'expo-sqlite';
import MapView, { Marker } from 'react-native-maps';
import axios from 'axios';

// --- CONFIG ---
// --- CONFIG ---
const API_URL = "http://192.168.4.1:5000"; // Pi Hotspot IP

// --- Database ---
const db = SQLite.openDatabase('survey_offline.db');

export default function App() {
  const [hasPermission, setHasPermission] = useState(null);
  const [location, setLocation] = useState(null);
  const [isCameraVisible, setCameraVisible] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [reports, setReports] = useState([]);
  const [isSyncing, setSyncing] = useState(false);
  
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
          'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL, lon REAL, timestamp TEXT, status TEXT, photo_uri TEXT, photo_base64 TEXT, notes TEXT, synced INTEGER DEFAULT 0)'
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
      const res = await axios.get(`${API_URL}/api/history`);
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
    const timestamp = new Date().toISOString();
    const lat = location.coords.latitude;
    const lon = location.coords.longitude;
    
    db.transaction(tx => {
      tx.executeSql(
        'INSERT INTO reports (lat, lon, timestamp, crop_status, photo_uri, photo_base64, synced) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [lat, lon, timestamp, 'Verification', uri, b64, 0],
        () => {
          Alert.alert("Success", "Report saved locally (Offline Ready)");
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
        await axios.post(`${API_URL}/gis/survey/data`, {
          drone_id: "field-officer-mobile",
          lat: item.lat,
          lon: item.lon,
          crop_status: "verified",
          crop_type: "Inspection",
          confidence: 1.0,
          image_base64: item.photo_base64
        });
        
        db.transaction(tx => {
          tx.executeSql('UPDATE reports SET synced = 1 WHERE id = ?', [item.id]);
        });
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
        <Text style={styles.headerTitle}>National Crop Surveyor</Text>
        <TouchableOpacity onPress={syncData} disabled={isSyncing}>
          <Text style={[styles.syncButton, isSyncing && { opacity: 0.5 }]}>
            {isSyncing ? "Syncing..." : "🔄 SYNC"}
          </Text>
        </TouchableOpacity>
      </View>

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
    backgroundColor: '#1a1a1a', flexDirection: 'row', justifyContent: 'space-between' 
  },
  headerTitle: { color: 'white', fontSize: 16, fontWeight: '900', letterSpacing: -0.5, uppercase: true },
  syncButton: { color: '#2ecc71', fontWeight: '900', fontSize: 12 },
  map: { height: 350, width: '100%' },
  captureButton: { 
    backgroundColor: '#1a1a1a', margin: 20, padding: 20, 
    borderRadius: 8, alignItems: 'center', shadowColor: '#000', 
    shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20
  },
  captureText: { color: 'white', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
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
  takePicButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  outerCircle: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, borderColor: 'white', justifyContent: 'center', alignItems: 'center' },
  innerCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'white' },
  closeCamera: { position: 'absolute', top: 50, right: 30, backgroundColor: 'rgba(0,0,0,0.8)', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }
});
