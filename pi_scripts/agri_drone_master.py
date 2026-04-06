import cv2
import json
import time
import os
import threading
import paho.mqtt.client as mqtt
from pymavlink import mavutil

# Try to import Ultralytics, but fallback to simulation if missing
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False
    print("⚠️ YOLOv8 (ultralytics) not installed. Falling back to simulation mode.")

# --- CONFIGURATION ---
PI_HOTSPOT_IP = "192.168.4.1"
TOPIC_MISSION = "gis/scout/mission"
TOPIC_TELEM = "gis/scout/telemetry"
TOPIC_SURVEY = "agri/survey/data"
UART_PORT = "/dev/ttyTHS1"
BAUD_RATE = 921600
MODEL_PATH = "models/crop_health_v1.pt"

# --- GLOBAL STATE (Shared Memory) ---
DRONE_DATA = {
    "lat": 0.0, "lon": 0.0, "alt": 0.0, 
    "bat": 0, "status": "OFFLINE", "speed": 0, "mode": "UNKNOWN",
    "gps_sats": 0, "current_wp": 0, "total_wp": 0
}
MISSION_POINTS = []

# --- MQTT CLIENT ---
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def on_mqtt_message(client, userdata, msg):
    global MISSION_POINTS
    try:
        data = json.loads(msg.payload.decode())
        if data['type'] == "COMMAND":
            act = data.get('act')
            if act == "ARM": send_mavlink_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 1)
            elif act == "DISARM": send_mavlink_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 21196)
            elif act == "SET_MODE": drone.set_mode(data.get('mode'))
        elif data['type'] == "MISSION_UPLOAD":
            MISSION_POINTS = data['waypoints'] if 'waypoints' in data else data.get('points', [])
            upload_mission_to_fc(MISSION_POINTS)
    except Exception as e: print(f"❌ MQTT Error: {e}")

mqtt_client.on_message = on_mqtt_message

# --- MAVLINK CONNECTION ---
print(f"🔌 Connecting to Flight Controller on {UART_PORT}...")
try:
    drone = mavutil.mavlink_connection(UART_PORT, baud=BAUD_RATE)
    drone.wait_heartbeat()
    print("✅ MAVLink Heartbeat Received")
except:
    print("⚠️ Hardware connection failed. Ensure Pixhawk is wired to UART.")

def send_mavlink_command(cmd, p1, p2=0, p3=0, p4=0, p5=0, p6=0, p7=0):
    drone.mav.command_long_send(drone.target_system, drone.target_component, cmd, 0, p1, p2, p3, p4, p5, p6, p7)

def upload_mission_to_fc(points):
    drone.mav.mission_clear_all_send(drone.target_system, drone.target_component)
    time.sleep(0.5)
    drone.mav.mission_count_send(drone.target_system, drone.target_component, len(points))

# --- THREAD: FLIGHT LOGIC ---
def flight_loop():
    global DRONE_DATA
    while True:
        try:
            msg = drone.recv_match(blocking=False)
            if msg:
                mtype = msg.get_type()
                if mtype == 'GLOBAL_POSITION_INT':
                    DRONE_DATA["lat"], DRONE_DATA["lon"] = msg.lat / 1e7, msg.lon / 1e7
                    DRONE_DATA["alt"] = msg.relative_alt / 1000.0
                elif mtype == 'SYS_STATUS':
                    DRONE_DATA["bat"] = msg.battery_remaining
                elif mtype == 'HEARTBEAT':
                    is_armed = msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
                    DRONE_DATA["status"] = "ARMED" if is_armed else "DISARMED"
                elif mtype == 'MISSION_REQUEST':
                    seq = msg.seq
                    if seq < len(MISSION_POINTS):
                        p = MISSION_POINTS[seq]
                        drone.mav.mission_item_int_send(
                            drone.target_system, drone.target_component, seq,
                            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                            mavutil.mavlink.MAV_CMD_NAV_WAYPOINT, 0, 1, 0, 0, 0, 0,
                            int(p['lat'] * 1e7), int(p['lng'] * 1e7), 20
                        )
            time.sleep(0.01)
        except Exception as e:
            time.sleep(0.1)

# --- THREAD: VISION LOGIC ---
def vision_loop():
    print("📷 Initializing Master Vision Thread...")
    model = YOLO(MODEL_PATH) if HAS_YOLO and os.path.exists(MODEL_PATH) else None
    cap = cv2.VideoCapture(0)
    
    while True:
        try:
            ret, frame = cap.read()
            if not ret: 
                time.sleep(5)
                continue

            if model:
                results = model(frame, conf=0.5, verbose=False)
                for r in results:
                    for box in r.boxes:
                        cls = int(box.cls[0])
                        conf = float(box.conf[0])
                        status = {0: "Healthy", 1: "Diseased", 2: "Weed"}.get(cls, "Unknown")
                        
                        payload = {
                            "drone_id": "jetson-master-01",
                            "lat": DRONE_DATA["lat"],
                            "lon": DRONE_DATA["lon"],
                            "crop_status": status.lower(),
                            "crop_type": "Corn",
                            "confidence": conf
                        }
                        mqtt_client.publish(TOPIC_SURVEY, json.dumps(payload))
                        print(f"🌾 AI Found {status} at {DRONE_DATA['lat']:.6f}, {DRONE_DATA['lon']:.6f}")
            else:
                time.sleep(2) # Simulation fallback
        except:
            time.sleep(5)

def telemetry_reporter():
    while True:
        try:
            mqtt_client.publish(TOPIC_TELEM, json.dumps(DRONE_DATA))
            time.sleep(0.5)
        except:
            time.sleep(5)

if __name__ == "__main__":
    # Initialize MQTT
    try:
        mqtt_client.connect(PI_HOTSPOT_IP, 1883, 60)
        mqtt_client.subscribe(TOPIC_MISSION)
        mqtt_client.loop_start() # Start MQTT in a background thread managed by paho
        print(f"✅ Connected to Pi Hotspot: {PI_HOTSPOT_IP}")
    except:
        print("🚨 Initial MQTT connection failed. Ensure Pi is reachable.")

    # Start Worker Threads
    threading.Thread(target=flight_loop, daemon=True).start()
    threading.Thread(target=vision_loop, daemon=True).start()
    threading.Thread(target=telemetry_reporter, daemon=True).start()
    
    print("\n🚀 AGRI-DRONE MASTER ONLINE")
    print("--------------------------------")
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Master Process Terminated")
