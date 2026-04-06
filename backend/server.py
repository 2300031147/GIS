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

# Removed eventlet to avoid conflicts with Paho MQTT threads

app = Flask(__name__)
CORS(app)
# Force threading mode for stability
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

BROKER = os.getenv('MQTT_BROKER', 'mqtt')
TOPIC_MISSION = "gis/scout/mission"
TOPIC_TELEM_SCOUT = "gis/scout/telemetry"
TOPIC_SURVEY = "agri/survey/data"

# --- Database Setup ---
DB_PATH = os.path.join("data", "survey.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
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

init_db()

def on_connect(client, userdata, flags, rc, properties=None):
    print("✅ API Connected to Broker")
    client.subscribe(TOPIC_TELEM_SCOUT)
    client.subscribe(TOPIC_SURVEY)
    print(f"👂 Subscribed to {TOPIC_SURVEY}")

def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode()
        print(f"📩 MSG Received on {msg.topic}") # Uncomment for verbose spam
        
        data = json.loads(payload_str)
        drone_type = "scout" if "scout" in msg.topic else "delivery"
        
        # Determine if it is telemetry
        if "telemetry" in msg.topic:
            # print(f"   -> Forwarding Telemetry for {drone_type}")
            socketio.emit('telemetry_update', {"drone": drone_type, "data": data})
        
        # Handle Survey Data
        elif msg.topic == TOPIC_SURVEY:
            print(f"🌾 CROP SURVEY DATA: {data}")
            save_detection(data)
            socketio.emit('survey_update', data)
            
    except Exception as e:
        print(f"❌ Error processing message: {e}")

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message
try:
    print(f"🔌 Connecting to Broker: {BROKER}")
    mqtt_client.connect(BROKER, 1883, 60)
    mqtt_client.loop_start()
except Exception as e:
    print(f"❌ MQTT Connection Fail: {e}")

    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("INSERT INTO detections (timestamp, drone_id, lat, lon, crop_status, crop_type, confidence, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                  (datetime.now().isoformat(), data.get('drone_id', 'scout'), data.get('lat'), data.get('lon'), 
                   data.get('crop_status', 'healthy'), data.get('crop_type', 'Corn'), data.get('confidence', 0.0), data.get('image_url', '')))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ DB Error: {e}")

@app.route('/upload_mission', methods=['POST'])
def upload_mission():
    data = request.json
    waypoints = data.get('waypoints')
    payload = json.dumps({"type": "MISSION_UPLOAD", "points": waypoints})
    mqtt_client.publish(TOPIC_MISSION, payload)
    return jsonify({"status": "Uploaded"})

@app.route('/gis/survey/data', methods=['POST'])
def mobile_sync():
    data = request.json
    print(f"📱 MOBILE SYNC DATA: {data}")
    
    # Check if base64 image is attached
    if data.get('image_base64'):
        try:
            img_data = base64.b64decode(data['image_base64'])
            filename = f"field_{int(time.time())}_{data.get('lat',0):.3f}.jpg"
            save_path = os.path.join(UPLOAD_DIR, filename)
            with open(save_path, "wb") as f:
                f.write(img_data)
            data['image_url'] = f"/static/uploads/{filename}"
        except Exception as e:
            print(f"❌ Image save error: {e}")

    save_detection(data)
    socketio.emit('survey_update', data)
    return jsonify({"status": "Synced"})

# Serving static uploads
from flask import send_from_directory
@app.route('/static/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# --- RESTORED COMMAND ROUTES ---
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
    data = request.json
    alt = data.get('alt', 10)  # Default to 10m if not specified
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "TAKEOFF", "alt": alt}))
    return jsonify({"status": f"TAKEOFF Command Sent (alt={alt}m)"})

@app.route('/land', methods=['POST'])
def land_drone():
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "LAND"}))
    return jsonify({"status": "LAND Command Sent"})

@app.route('/indoor_mode', methods=['POST'])
def indoor_mode():
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "INDOOR_MODE"}))
    return jsonify({"status": "INDOOR MODE SET"})

@app.route('/set_mode', methods=['POST'])
def set_flight_mode():
    data = request.json
    mode = data.get('mode')
    mqtt_client.publish(TOPIC_MISSION, json.dumps({"type": "COMMAND", "act": "SET_MODE", "mode": mode}))
    return jsonify({"status": f"Mode {mode} Sent"})

@app.route('/rc_override', methods=['POST'])
def rc_override():
    data = request.json
    channels = data.get('channels', []) # List of 8 PWM values
    payload = {
        "type": "COMMAND",
        "act": "RC_OVERRIDE",
        "channels": channels
    }
    mqtt_client.publish(TOPIC_MISSION, json.dumps(payload))
    return jsonify({"status": "RC OVERRIDE SENT"})

@app.route('/api/history', methods=['GET'])
def get_history():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM detections ORDER BY timestamp DESC LIMIT 100")
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(rows)

@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Healthy vs Diseased vs Weeds
    c.execute("SELECT crop_status, COUNT(*) FROM detections GROUP BY crop_status")
    stats = dict(c.fetchall())
    
    # Total count
    c.execute("SELECT COUNT(*) FROM detections")
    total = c.fetchone()[0]
    
    conn.close()
    return jsonify({
        "distribution": stats,
        "total_detections": total,
        "acres_scanned": total * 0.05 # Mock calculation: 0.05 acres per detection spot
    })

if __name__ == '__main__':
    # allow_unsafe_werkzeug=True is required when using threading mode in Docker
    socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
