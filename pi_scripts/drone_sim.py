import paho.mqtt.client as mqtt
import json
import time
import threading
import math

# --- CONFIG ---
BROKER_IP = "localhost" # Set to Pi's Tailscale IP
TOPIC_MISSION = "gis/scout/mission"
TOPIC_TELEM = "gis/scout/telemetry"

client = mqtt.mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

# --- STATE ---
DRONE_STATE = {
    "lat": 16.506,
    "lon": 80.648,
    "alt": 0,
    "speed": 0,
    "bat": 100,
    "status": "DISARMED",
    "mode": "STABILIZE",
    "gps_sats": 18,
    "current_wp": 0,
    "total_wp": 0
}

def on_message(client, userdata, msg):
    global DRONE_STATE
    data = json.loads(msg.payload.decode())
    print(f"📩 SIM: Received Command/Mission: {data.get('type') or data.get('act')}")

    if data.get('type') == "MISSION_UPLOAD":
        waypoints = data['points']
        DRONE_STATE["total_wp"] = len(waypoints)
        DRONE_STATE["status"] = "ARMED"
        DRONE_STATE["mode"] = "AUTO"
        threading.Thread(target=simulate_flight, args=(waypoints,), daemon=True).start()

    elif data.get('act') == "ARM":
        DRONE_STATE["status"] = "ARMED"
    elif data.get('act') == "LAND":
        DRONE_STATE["mode"] = "LAND"
        DRONE_STATE["status"] = "LANDED"

def simulate_flight(waypoints):
    global DRONE_STATE
    print("🚀 SIM: Starting Autonomous Mission...")
    DRONE_STATE["alt"] = 20
    DRONE_STATE["speed"] = 5
    
    for i, wp in enumerate(waypoints):
        DRONE_STATE["current_wp"] = i + 1
        target_lat = wp['lat']
        target_lon = wp['lng']
        
        # Smooth travel simulation
        steps = 10
        start_lat = DRONE_STATE["lat"]
        start_lon = DRONE_STATE["lon"]
        
        for step in range(steps):
            DRONE_STATE["lat"] += (target_lat - start_lat) / steps
            DRONE_STATE["lon"] += (target_lon - start_lon) / steps
            DRONE_STATE["bat"] -= 0.05
            time.sleep(0.5)
            
        print(f"📍 SIM: Reached Waypoint {i+1}/{len(waypoints)}")

    print("🏁 SIM: Mission Complete. RTL.")
    DRONE_STATE["mode"] = "RTL"
    time.sleep(5)
    DRONE_STATE["alt"] = 0
    DRONE_STATE["status"] = "DISARMED"
    DRONE_STATE["mode"] = "LANDED"

def publish_telemetry():
    while True:
        client.publish(TOPIC_TELEM, json.dumps(DRONE_STATE))
        time.sleep(1)

if __name__ == "__main__":
    client.on_message = on_message
    try:
        client.connect(BROKER_IP, 1883, 60)
        client.subscribe(TOPIC_MISSION)
        print(f"✅ Drone Simulator Online! Linked to {BROKER_IP}")
        
        # Start telemetry loop
        threading.Thread(target=publish_telemetry, daemon=True).start()
        
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n🛑 Simulator Stopped")
