from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import paho.mqtt.client as mqtt
import json
import os
import sqlite3
import base64
from datetime import datetime

# --- Constants ---
UPLOAD_DIR = os.path.join("data", "uploads")
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

BROKER = os.getenv("MQTT_BROKER", "localhost") 
TOPIC_MISSION = "gis/scout/mission"
TOPIC_TELEM_SCOUT = "gis/scout/telemetry"
TOPIC_SURVEY = "agri/survey/data"

# --- Database Setup ---
DB_PATH = os.path.join("data", "survey.db")

def init_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS detections
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  timestamp TEXT,
                  drone_id TEXT,
                  lat REAL,
                  lon REAL,
                  crop_status TEXT,
                  crop_type TEXT,
                  confidence REAL,
                  image_url TEXT)''')
    conn.commit()
    conn.close()

def save_detection(data):
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        c = conn.cursor()
        c.execute("INSERT INTO detections (timestamp, drone_id, lat, lon, crop_status, crop_type, confidence, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  (datetime.now().isoformat(), data.get('drone_id', 'jetson-01'), data.get('lat'), data.get('lon'), 
                   data.get('crop_status', 'healthy'), data.get('crop_type', 'Corn'), data.get('confidence', 0.0), data.get('image_url', '')))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ DB Error: {e}")

# --- MQTT Setup ---
def on_connect(client, userdata, flags, rc, properties=None):
    print("✅ API Connected to Broker")
    client.subscribe(TOPIC_TELEM_SCOUT)
    client.subscribe(TOPIC_SURVEY)
    print(f"👂 Subscribed to {TOPIC_SURVEY}")

def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode()
        data = json.loads(payload_str)
        
        if msg.topic == TOPIC_TELEM_SCOUT:
            socketio.emit('telemetry_update', {"drone": "scout", "data": data})
        elif msg.topic == TOPIC_SURVEY:
            print(f"🌾 CROP SURVEY DATA: {data}")
            save_detection(data)
            socketio.emit('survey_update', data)
        
        # Additional state tracking if mission data is present
        if 'current_wp' in data:
            socketio.emit('mission_status', {"current": data['current_wp'], "total": data.get('total_wp', 0)})
            
    except Exception as e:
        print(f"❌ Errror processing message: {e}")

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def start_mqtt():
    try:
        mqtt_client.connect(BROKER, 1883, 60)
        mqtt_client.loop_start()
    except Exception as e:
        print(f"❌ MQTT Connection Fail: {e}")

# --- REST API ---
@app.route('/gis/survey/data', methods=['POST'])
def mobile_sync():
    data = request.json
    if not data: return jsonify({"error": "No data"}), 400
    
    # Check if base64 image is attached
    if data.get('image_base64'):
        img_data = base64.b64decode(data['image_base64'])
        filename = f"verified_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(img_data)
        data['image_url'] = f"/uploads/{filename}"
    
    save_detection(data)
    socketio.emit('survey_update', data)
    return jsonify({"status": "Field data synced"})

@app.route('/upload_mission', methods=['POST'])
def upload_mission():
    data = request.json
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "MISSION_UPLOAD", "points": data['waypoints']}))
    return jsonify({"status": "Mission uploaded to GIS unit"})

@app.route('/arm', methods=['POST'])
def arm_drone():
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "ARM"}))
    return jsonify({"status": "ARM Command Sent"})

@app.route('/disarm', methods=['POST'])
def disarm_drone():
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "DISARM"}))
    return jsonify({"status": "DISARM Command Sent"})

@app.route('/takeoff', methods=['POST'])
def takeoff_drone():
    alt = request.json.get('alt', 10)
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "TAKEOFF", "alt": alt}))
    return jsonify({"status": f"TAKEOFF Command Sent (alt={alt}m)"})

@app.route('/land', methods=['POST'])
def land_drone():
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "LAND"}))
    return jsonify({"status": "LAND Command Sent"})

@app.route('/set_mode', methods=['POST'])
def set_flight_mode():
    mode = request.json.get('mode')
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "SET_MODE", "mode": mode}))
    return jsonify({"status": f"Mode {mode} Sent"})

@app.route('/rc_override', methods=['POST'])
def rc_override():
    channels = request.json.get('channels')
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "RC_OVERRIDE", "channels": channels}))
    return jsonify({"status": "RC Override Sent"})

@app.route('/api/history', methods=['GET'])
def get_history():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM detections ORDER BY timestamp DESC LIMIT 100")
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    c = conn.cursor()
    c.execute("SELECT crop_status, COUNT(*) FROM detections GROUP BY crop_status")
    stats = dict(c.fetchall())
    c.execute("SELECT COUNT(*) FROM detections")
    total = c.fetchone()[0]
    conn.close()
    return jsonify({
        "distribution": stats,
        "total_detections": total,
        "acres_scanned": total * 0.05
    })

if __name__ == '__main__':
    init_db()
    start_mqtt()
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
