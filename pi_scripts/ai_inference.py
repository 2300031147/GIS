import paho.mqtt.client as mqtt
import json
import time
import os
import cv2

# Try to import Ultralytics, but fallback to simulation if missing
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False
    print("⚠️ YOLOv8 (ultralytics) not installed. Falling back to simulation mode.")

# --- CONFIG ---
BROKER_IP = "192.168.4.1" # Pi Hotspot IP
TOPIC_SURVEY = "agri/survey/data"
TOPIC_TELEM = "gis/scout/telemetry"
MODEL_PATH = "models/crop_health_v1.pt" 

# --- STATE ---
current_lat = 0.0
current_lon = 0.0

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def on_message(client, userdata, msg):
    global current_lat, current_lon
    if msg.topic == TOPIC_TELEM:
        try:
            data = json.loads(msg.payload.decode())
            current_lat = data.get('lat', current_lat)
            current_lon = data.get('lon', current_lon)
        except:
            pass

def connect_mqtt():
    try:
        client.on_message = on_message
        client.connect(BROKER_IP, 1883, 60)
        client.subscribe(TOPIC_TELEM)
        print(f"✅ AI Linked to Broker at {BROKER_IP} (Subscribed to Telemetry)")
    except Exception as e:
        print(f"❌ Connection Failed: {e}")

def run_detection():
    # Load model if available
    model = None
    if HAS_YOLO and os.path.exists(MODEL_PATH):
        model = YOLO(MODEL_PATH)
        print(f"🚀 Loaded AI Model: {MODEL_PATH}")
    else:
        print("💡 TIP: Place your trained YOLOv8 model in 'models/crop_health_v1.pt'")

    # Initialize Camera (CSI or USB)
    cap = cv2.VideoCapture(0)
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("❌ Camera Error")
            break

        # GIS Mappings (Adjust based on your model's classes)
        # Class 0: Healthy, Class 1: Diseased, Class 2: Weeds
        status_map = {0: "Healthy", 1: "Diseased", 2: "Weed"}
        crop_name = "Corn" 

        if model:
            results = model(frame, conf=0.5)
            for r in results:
                for box in r.boxes:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    status = status_map.get(cls, "Unknown")
                    publish_detection(status, crop_name, conf)
        else:
            # Simulation Mode
            time.sleep(5)
            publish_detection("Healthy", "Soybean", 0.98)

def publish_detection(status, crop, conf):
    global current_lat, current_lon
    payload = {
        "drone_id": "jetson-01",
        "lat": current_lat, # Live GPS from Flight Controller!
        "lon": current_lon, 
        "crop_status": status.lower(), 
        "crop_type": crop,
        "confidence": conf,
        "image_url": "" 
    }
    print(f"🌾 AI Found {status} {crop} at {current_lat}, {current_lon}")
    client.publish(TOPIC_SURVEY, json.dumps(payload))

if __name__ == "__main__":
    client.loop_start() # Start MQTT in background
    connect_mqtt()
    try:
        run_detection()
    except KeyboardInterrupt:
        print("\n🛑 AI Inference Stopped")
