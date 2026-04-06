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
BROKER_IP = "localhost" # Set to Pi's Tailscale IP
TOPIC_SURVEY = "agri/survey/data"
MODEL_PATH = "models/crop_health_v1.pt" # Path to your custom-trained agricultural model

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def connect_mqtt():
    try:
        client.connect(BROKER_IP, 1883, 60)
        print(f"✅ AI Linked to Broker at {BROKER_IP}")
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
        crop_name = "Corn" # Default for this field

        if model:
            # RUN REAL AI INFERENCE
            results = model(frame, conf=0.5)
            for r in results:
                for box in r.boxes:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    status = status_map.get(cls, "Unknown")
                    
                    # Mock GPS (Real script would integrate with Mavlink to get current drone lat/lon)
                    # For now we use placeholder logic
                    publish_detection(status, crop_name, conf)
        else:
            # FALLBACK SIMULATION (For hackathon demo without Jetson)
            time.sleep(5)
            publish_detection("Healthy", "Soybean", 0.98)

def publish_detection(status, crop, conf):
    # This payload matches the required GIS format
    payload = {
        "drone_id": "jetson-01",
        "lat": 16.506 + (time.time() % 100) * 0.0001, # Placeholder movement
        "lon": 80.648 + (time.time() % 100) * 0.0001,
        "crop_status": status.lower(), # User requested lowercase "weed", "diseased", etc.
        "crop_type": crop,
        "confidence": conf,
        "image_url": "" 
    }
    print(f"🌾 AI Found {status} {crop} (Conf: {conf:.2f})")
    client.publish(TOPIC_SURVEY, json.dumps(payload))

if __name__ == "__main__":
    connect_mqtt()
    try:
        run_detection()
    except KeyboardInterrupt:
        print("\n🛑 AI Inference Stopped")
