from pymavlink import mavutil
import paho.mqtt.client as mqtt
import json
import time
import threading

# 🔴 CONFIGURATION - YOUR TAILSCALE IP
BROKER_IP = "100.125.45.22"
TOPIC_MISSION = "gis/scout/mission"
TOPIC_TELEM = "gis/scout/telemetry"

COPTER_MODES = {
    0: 'STABILIZE', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER', 6: 'RTL', 9: 'LAND'
}

print("🔌 Connecting to Mavlink Router (UDP)...")
# Use 0.0.0.0 to listen on all interfaces (Localhost + Tailscale/LAN)
drone = mavutil.mavlink_connection('udpin:0.0.0.0:14550')

print("⏳ Waiting for heartbeat...")
while True:
    msg = drone.recv_match(type='HEARTBEAT', blocking=True, timeout=1)
    if msg:
        drone.target_system = msg.get_srcSystem()
        drone.target_component = msg.get_srcComponent()
        print(f"✅ Heartbeat from System {drone.target_system}, Component {drone.target_component}")
        break
    print("⚠️ No heartbeat yet... check Mavlink Router is running and sending to port 14550")

print("✅ Scout Online")

# Request telemetry streams from the flight controller
print("📡 Requesting telemetry streams...")
drone.mav.request_data_stream_send(
    drone.target_system, drone.target_component,
    mavutil.mavlink.MAV_DATA_STREAM_ALL,
    4, 1)  # 4Hz rate, enable=1

# --- STATE ---
DRONE_DATA = {
    "lat": 0, "lon": 0, "alt": 0, 
    "bat": 0,           # Battery percentage (0-100)
    "bat_voltage": 0,   # Voltage in volts
    "bat_current": 0,   # Current draw in amps
    "bat_time_min": 0,  # Estimated minutes remaining
    "gps_sats": 0,      # Number of GPS satellites
    "status": "DISARMED", "speed": 0, "mode": "UNKNOWN",
    "current_wp": 0, "total_wp": 0
}
BATTERY_CAPACITY_MAH = 5000  # Default battery capacity, adjust for your battery
LAST_HEARTBEAT = 0
MISSION_UPLOAD_IN_PROGRESS = False  # Track mission upload state
AUTO_START_MISSION = False  # Flag to auto-start mission after upload
MISSION_POINTS = [] # Store mission to respond to FC requests

# Human-readable mapping for MAV_CMD_ACK results
MAV_RESULT_NAMES = {
    mavutil.mavlink.MAV_RESULT_ACCEPTED: "Accepted",
    mavutil.mavlink.MAV_RESULT_TEMPORARILY_REJECTED: "Temp Rejected",
    mavutil.mavlink.MAV_RESULT_DENIED: "Denied",
    mavutil.mavlink.MAV_RESULT_UNSUPPORTED: "Unsupported",
    mavutil.mavlink.MAV_RESULT_FAILED: "Failed",
    mavutil.mavlink.MAV_RESULT_IN_PROGRESS: "In Progress",
    getattr(mavutil.mavlink, 'MAV_RESULT_CANCELLED', 6): "Cancelled"
}

# --- COMMAND HELPERS (Send Only) ---
def send_arm():
    print("⚠️ Sending ARM Command...")
    drone.mav.command_long_send(
        drone.target_system, drone.target_component,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, 1, 0, 0, 0, 0, 0, 0)
    # Do NOT set mode immediately after arm; let it complete first 

def send_disarm(force=True):
    """Disarm the drone. Uses force=True by default to bypass safety checks."""
    print("⚠️ Sending DISARM Command...")
    # ArduPilot magic number 21196 forces disarm bypassing safety checks
    magic_override = 21196 if force else 0
    
    # If not forcing, switch to LAND mode first
    if not force and DRONE_DATA.get('mode') != 'LAND':
        print("⚠️ Switching to LAND mode before DISARM...")
        drone.set_mode('LAND')
        time.sleep(2)  # Wait for landing to initiate
    
    drone.mav.command_long_send(
        drone.target_system, drone.target_component,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, 0, magic_override, 0, 0, 0, 0, 0)

# Global flag for Indoor Mode
INDOOR_MODE = False

def set_indoor_mode():
    global INDOOR_MODE
    INDOOR_MODE = True
    print("⚠️ SETTING INDOOR MODE (Safety Checks Disabled + GPS Bypass)")
    # Disable Arming Checks
    drone.mav.param_set_send(drone.target_system, drone.target_component, b'ARMING_CHECK', 0, mavutil.mavlink.MAV_PARAM_TYPE_INT32)
    # Disable Radio Failsafe (FS_THR_ENABLE)
    drone.mav.param_set_send(drone.target_system, drone.target_component, b'FS_THR_ENABLE', 0, mavutil.mavlink.MAV_PARAM_TYPE_INT32)
    # Disable GCS Failsafe (FS_GCS_ENABLE)
    drone.mav.param_set_send(drone.target_system, drone.target_component, b'FS_GCS_ENABLE', 0, mavutil.mavlink.MAV_PARAM_TYPE_INT32)
    # Disable Auto Disarm Delay (DISARM_DELAY)
    drone.mav.param_set_send(drone.target_system, drone.target_component, b'DISARM_DELAY', 0, mavutil.mavlink.MAV_PARAM_TYPE_INT32)
    # Ensure motor spin
    drone.mav.param_set_send(drone.target_system, drone.target_component, b'MOT_SPIN_ARM', 0.10, mavutil.mavlink.MAV_PARAM_TYPE_REAL32)

def override_rc(channels):
    pwm = [65535] * 8
    for i, val in enumerate(channels):
        if i < 8: pwm[i] = int(val)
    print(f"🎮 RC OVERRIDE: {pwm}")
    drone.mav.rc_channels_override_send(drone.target_system, drone.target_component, *pwm)

def upload_mission_to_fc(waypoints, auto_start=True):
    global MISSION_POINTS, MISSION_UPLOAD_IN_PROGRESS, AUTO_START_MISSION
    print(f"📤 Uploading {len(waypoints)} points...")
    MISSION_POINTS = waypoints # Store for Protocol
    MISSION_UPLOAD_IN_PROGRESS = True
    AUTO_START_MISSION = auto_start  # Store whether to auto-start after upload
    drone.mav.mission_clear_all_send(drone.target_system, drone.target_component)
    time.sleep(0.2)  # Small delay for clear to process
    # Send Count - FC will then request each Wpoint
    DRONE_DATA["total_wp"] = len(waypoints)
    drone.mav.mission_count_send(drone.target_system, drone.target_component, len(waypoints))

def send_mission_item(seq):
    if seq < len(MISSION_POINTS):
        p = MISSION_POINTS[seq]
        print(f"   sending WP {seq}: {p['lat']}, {p['lng']}")
        drone.mav.mission_item_int_send(
            drone.target_system, drone.target_component,
            seq,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
            mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
            0, 1, # current, autocontinue
            0, 0, 0, 0, # params 1-4
            int(p['lat'] * 1e7),
            int(p['lng'] * 1e7),
            20 # Default Altitude 20m
        )

def handle_takeoff_command(alt):
    """Handle TAKEOFF command with proper sequencing (runs in separate thread)."""
    try:
        # Step 1: Validate GPS position
        print(f"🛫 TAKEOFF sequence starting (alt={alt}m)...")
        
        # Check for GPS, but allow bypass if INDOOR_MODE is True
        for _ in range(10):
            if DRONE_DATA.get('lat', 0) != 0 and DRONE_DATA.get('lon', 0) != 0:
                break
            time.sleep(0.1)
        
        lat = float(DRONE_DATA.get('lat', 0))
        lon = float(DRONE_DATA.get('lon', 0))
        
        if (lat == 0 or lon == 0) and not INDOOR_MODE:
            print("❌ TAKEOFF aborted: No valid GPS position (lat/lon=0)")
            print("   💡 If strictly necessary, enable 'Indoor Mode' to bypass this check.")
            return
        
        if INDOOR_MODE and (lat == 0 or lon == 0):
             print("⚠️ Indoor Mode: Bypassing GPS check...")
        
        # Step 2: Ensure GUIDED mode (CRITICAL - TAKEOFF only works in GUIDED)
        current_mode = DRONE_DATA.get('mode', '')
        if current_mode != 'GUIDED':
            print(f"⚠️ Switching from {current_mode} to GUIDED mode...")
            drone.set_mode('GUIDED')
            time.sleep(1.5)  # Wait for mode change
        
        # Step 3: Ensure armed
        if DRONE_DATA.get('status') != 'ARMED':
            print("⚠️ Not armed; arming before takeoff...")
            send_arm()
            time.sleep(2)  # Wait for arming to complete
        
        # Step 4: Send TAKEOFF command
        print(f"🛫 Sending TAKEOFF to {alt}m at ({lat:.6f}, {lon:.6f})")
        drone.mav.command_long_send(
            drone.target_system, drone.target_component,
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            0,              # confirmation
            0,              # param1: minimum pitch (if airspeed sensor)
            0,              # param2: empty
            0,              # param3: empty
            float('nan'),   # param4: yaw (NaN = use current heading)
            lat,            # param5: latitude
            lon,            # param6: longitude
            alt)            # param7: altitude
    except Exception as e:
        print(f"❌ TAKEOFF Error: {e}")

# --- MQTT CALLBACKS ---
def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        print(f"📩 MQTT RAW: {payload}")
        data = json.loads(payload)
        
        if data['type'] == "COMMAND":
            act = data.get('act')
            print(f"⚙️ EXECUTING COMMAND: {act}")
            
            if act == "ARM": 
                send_arm()
            elif act == "DISARM":
                force = bool(data.get('force', True))  # Default to force disarm
                send_disarm(force=force)
            elif act == "LAND": 
                drone.set_mode('LAND')
                print("🛬 LANDING")
            elif act == "TAKEOFF":
                # Use threading to avoid blocking MQTT callback
                alt = float(data.get('alt', 10))
                threading.Thread(target=handle_takeoff_command, args=(alt,), daemon=True).start()
            elif act == "INDOOR_MODE": 
                set_indoor_mode()
            elif act == "RC_OVERRIDE": 
                override_rc(data.get('channels', []))
            elif act == "SET_MODE":
                mode = data.get('mode')
                print(f"⚠️ Mode -> {mode}")
                drone.set_mode(mode)
        elif data['type'] == "MISSION_UPLOAD":
            upload_mission_to_fc(data['points'])

    except Exception as e:
        print(f"❌ MQTT Message Error: {e}")
        import traceback
        traceback.print_exc()

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("✅ Connected to GCS MQTT Broker")
        client.subscribe(TOPIC_MISSION)
        print(f"📡 Subscribed to {TOPIC_MISSION}")
    else:
        print(f"❌ Connection Failed: Code {rc}")

client.on_connect = on_connect
client.on_message = on_message

while True:
    try:
        client.connect(BROKER_IP, 1883, 60)
        break
    except Exception as e:
        print(f"⚠️ MQTT Connection Failed: {e}")
        print("   Retrying in 5 seconds...")
        time.sleep(5)

client.loop_start()

# --- MAIN LOOP (Single Threaded MAVLink) ---
last_telem_send = time.time()

try:
    while True:
        # Read ALL messages (Non-blocking)
        msg = drone.recv_match(blocking=False)
        if msg:
            mtype = msg.get_type()
            
            if mtype == 'HEARTBEAT':
                LAST_HEARTBEAT = time.time()
                is_armed = msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
                DRONE_DATA["status"] = "ARMED" if is_armed else "DISARMED"
                cid = msg.custom_mode
                DRONE_DATA["mode"] = COPTER_MODES.get(cid, str(cid))
                
            elif mtype == 'MISSION_ITEM_REACHED':
                DRONE_DATA["current_wp"] = msg.seq + 1
                
            elif mtype == 'GLOBAL_POSITION_INT':
                DRONE_DATA["lat"] = msg.lat / 1e7
                DRONE_DATA["lon"] = msg.lon / 1e7
                DRONE_DATA["alt"] = msg.relative_alt / 1000.0
                
            elif mtype == 'SYS_STATUS':
                DRONE_DATA["bat"] = msg.battery_remaining
                # Battery voltage: received in millivolts, convert to volts
                DRONE_DATA["bat_voltage"] = msg.voltage_battery / 1000.0 if msg.voltage_battery != 65535 else 0
                # Current draw: received in 10*milliamps, convert to amps
                DRONE_DATA["bat_current"] = msg.current_battery / 100.0 if msg.current_battery != -1 else 0
                
                # Calculate estimated time remaining (minutes)
                # Formula: (capacity * remaining%) / current_draw / 60
                if DRONE_DATA["bat_current"] > 0.1:  # Only calculate if drawing meaningful current
                    remaining_mah = BATTERY_CAPACITY_MAH * (DRONE_DATA["bat"] / 100.0)
                    time_hours = remaining_mah / (DRONE_DATA["bat_current"] * 1000)
                    DRONE_DATA["bat_time_min"] = round(time_hours * 60, 1)
                else:
                    DRONE_DATA["bat_time_min"] = 0  # No current draw, can't estimate
                
            elif mtype == 'VFR_HUD':
                DRONE_DATA["speed"] = round(msg.groundspeed, 1)
            
            elif mtype == 'GPS_RAW_INT':
                # GPS satellite count
                DRONE_DATA["gps_sats"] = msg.satellites_visible
                DRONE_DATA["gps_fix"] = msg.fix_type
                
            elif mtype == 'COMMAND_ACK':
                res_text = MAV_RESULT_NAMES.get(msg.result, str(msg.result))
                print(f"🔔 ACK Received: Cmd={msg.command} Res={msg.result} ({res_text})")
                if msg.result != mavutil.mavlink.MAV_RESULT_ACCEPTED:
                    # Provide hints for common failures
                    if msg.command == mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM:
                        print("❌ ARM/DISARM refused: check mode, landed state, or use force=true")
                    elif msg.command == mavutil.mavlink.MAV_CMD_NAV_TAKEOFF:
                        print("❌ TAKEOFF refused: Ensure GUIDED mode, armed, and valid GPS")
                        print(f"   Current state: Mode={DRONE_DATA.get('mode')} Status={DRONE_DATA.get('status')} GPS=({DRONE_DATA.get('lat')}, {DRONE_DATA.get('lon')})")
                    else:
                        print("❌ COMMAND FAILED/REFUSED")
            
            elif mtype == 'STATUSTEXT':
                print(f"🤖 FC MSG: {msg.text}")
                
            elif mtype == 'MISSION_REQUEST':
                # Handle mission upload parts naturally in loop
                seq = msg.seq
                print(f"   FC Requesting WP {seq}")
                send_mission_item(seq)
            
            elif mtype == 'MISSION_ACK':
                global MISSION_UPLOAD_IN_PROGRESS, AUTO_START_MISSION
                if msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                    print("✅ Mission Upload Complete!")
                    MISSION_UPLOAD_IN_PROGRESS = False
                    
                    # Auto-start mission if requested
                    if AUTO_START_MISSION:
                        print("🚀 Auto-starting mission...")
                        time.sleep(0.5)
                        
                        # Ensure armed first
                        if DRONE_DATA.get('status') != 'ARMED':
                            print("   ⚠️ Arming for mission...")
                            send_arm()
                            time.sleep(2)
                        
                        # Switch to AUTO mode to start mission
                        print("   ⚠️ Switching to AUTO mode...")
                        drone.set_mode('AUTO')
                        AUTO_START_MISSION = False
                else:
                    print(f"❌ Mission Upload Failed: Error {msg.type}")
                    MISSION_UPLOAD_IN_PROGRESS = False
                    AUTO_START_MISSION = False

        # Periodic Telemetry Publish
        if time.time() - last_telem_send > 0.5:
            client.publish(TOPIC_TELEM, json.dumps(DRONE_DATA))
            # print(f"📡 Telem: {DRONE_DATA['status']} Alt:{DRONE_DATA['alt']}")
            if int(time.time()) % 2 == 0: 
                print(f"\r📡 Sats:{DRONE_DATA.get('gps_sats',0)} Fix:{DRONE_DATA.get('gps_fix',0)} Bat:{DRONE_DATA.get('bat',0)}% Mode:{DRONE_DATA.get('mode')}", end="", flush=True)
            last_telem_send = time.time()
            
        time.sleep(0.001) # Reduce CPU

except KeyboardInterrupt:
    print("🚨 STOPPING")
