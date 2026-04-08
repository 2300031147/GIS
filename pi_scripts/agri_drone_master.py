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
UART_PORT = "/dev/ttyACM0"
BAUD_RATE = 115200 # Standard for USB ACM link
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
            if ('drone' not in globals()):
                print("⚠️ Command ignored: Drone connection not initialized")
                return
            
            if act == "ARM": send_mavlink_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 1)
            elif act == "DISARM": send_mavlink_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 21196)
            elif act == "SET_MODE":
                mode = data.get('mode')
                if ('drone' in globals()) and mode in drone.mode_mapping():
                    drone.set_mode(drone.mode_mapping()[mode])
                else:
                    print(f"⚠️ Unknown mode: {mode}")
            elif act == "RC_OVERRIDE":
                channels = data.get('channels', [0]*8)
                # MAVLink RC_CHANNELS_OVERRIDE expects 18 channels, but we send 8
                drone.mav.rc_channels_override_send(
                    drone.target_system, drone.target_component,
                    *channels, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
                )
        elif data['type'] == "MISSION_UPLOAD":
            MISSION_POINTS = data['waypoints'] if 'waypoints' in data else data.get('points', [])
            DRONE_DATA['total_wp'] = len(MISSION_POINTS)
            DRONE_DATA['current_wp'] = 0
            upload_mission_to_fc(MISSION_POINTS)
    except Exception as e: 
        print(f"❌ MQTT Error: {e}")

mqtt_client.on_message = on_mqtt_message

# --- MAVLINK CONNECTION ---
print(f"🔌 Connecting to Flight Controller on {UART_PORT}...")
def init_main_connection():
    global drone
    try:
        drone = mavutil.mavlink_connection(UART_PORT, baud=BAUD_RATE)
        drone.wait_heartbeat()
        print("✅ MAVLink Heartbeat Received")
    except Exception as e:
        print(f"⚠️ Hardware connection failed: {e}")

threading.Thread(target=init_main_connection, daemon=True).start()

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
            if ('drone' not in globals()): 
                time.sleep(1)
                continue
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
                        # Correct MAV_CMD_NAV_WAYPOINT for mission upload
                        drone.mav.mission_item_int_send(
                            drone.target_system, drone.target_component, seq,
                            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT, # Frame must match FC expectations
                            mavutil.mavlink.MAV_CMD_NAV_WAYPOINT, 0, 1, 0, 0, 0, 0,
                            int(p['lat'] * 1e7), int(p['lng'] * 1e7), 20 # 20m default alt
                        )
                        print(f"📡 Uploaded Waypoint #{seq}")
                elif mtype == 'MISSION_ACK':
                    print("✅ Mission Upload ACK Received from Flight Controller")
                elif mtype == 'MISSION_CURRENT':
                    DRONE_DATA["current_wp"] = msg.seq
                elif mtype == 'VFR_HUD':
                    DRONE_DATA["speed"] = round(msg.groundspeed, 1)
            time.sleep(0.01)
        except Exception as e:
            time.sleep(0.1)

# --- THREAD: VISION LOGIC ---
def vision_loop():
    print("📷 Initializing Master Vision [SIMULATION MODE]...")
    import random
    
    while True:
        try:
            # Simulate processing time
            time.sleep(5) 

            # Only "detect" if we have valid coordinates (not 0)
            if abs(DRONE_DATA['lat']) > 0.1:
                # Randomly pick a crop status
                cls_idx = random.choices([0, 1, 2], weights=[0.8, 0.1, 0.1])[0] 
                status = {0: "Healthy", 1: "Diseased", 2: "Weed"}.get(cls_idx)
                conf = random.uniform(0.85, 0.99)
                
                payload = {
                    "drone_id": "jetson-master-01",
                    "lat": DRONE_DATA["lat"] + random.uniform(-0.00002, 0.00002),
                    "lon": DRONE_DATA["lon"] + random.uniform(-0.00002, 0.00002),
                    "crop_status": status.lower(),
                    "crop_type": "Corn",
                    "confidence": conf,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
                }
                mqtt_client.publish(TOPIC_SURVEY, json.dumps(payload))
                print(f"🌾 [SIM] AI Found {status} at {DRONE_DATA['lat']:.6f}, {DRONE_DATA['lon']:.6f}")
            
        except Exception as e:
            print(f"⚠️ Vision Loop Error: {e}")
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
        broker = os.getenv("MQTT_BROKER", PI_HOTSPOT_IP)
        mqtt_client.connect(broker, 1883, 60)
        mqtt_client.subscribe(TOPIC_MISSION)
        mqtt_client.loop_start() 
        print(f"✅ Connected to MQTT Broker: {broker}")
    except:
        print(f"🚨 MQTT connection failed to {broker}. Ensure Pi is reachable.")

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
