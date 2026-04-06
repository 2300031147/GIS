import json
import time
import paho.mqtt.client as mqtt

# --- CONFIG ---
BROKER_IP = "localhost"
TOPIC_MISSION = "gis/scout/mission"

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

def generate_lawnmower_grid(corners, sweep_width_m=15.0):
    """
    corners: list of 4 dicts [{'lat': ..., 'lng': ...}, ...]
    sweep_width_m: distance between parallel lines in meters
    """
    if len(corners) < 4:
        return []

    # Get bounds
    lats = [p['lat'] for p in corners]
    lngs = [p['lng'] for p in corners]
    
    min_lat, max_lat = min(lats), max_lats = max(lats)
    min_lng, max_lng = min(lngs), max_lngs = max(lngs)

    # Approx degrees to meters (simple projection for local field)
    # 1 deg lat ~= 111,000m
    # 1 deg lng ~= 111,000m * cos(lat)
    lat_step = sweep_width_m / 111000.0
    lng_step = sweep_width_m / (111000.0 * 0.96) # Approx for 16 deg latitude

    grid = []
    current_lat = min_lat
    direction = 1 # 1 for E, -1 for W

    while current_lat <= max_lat:
        # Add start and end of path for this "row"
        if direction == 1:
            grid.append({"lat": current_lat, "lng": min_lng})
            grid.append({"lat": current_lat, "lng": max_lng})
        else:
            grid.append({"lat": current_lat, "lng": max_lng})
            grid.append({"lat": current_lat, "lng": min_lng})
        
        current_lat += lat_step
        direction *= -1

    return grid

def upload_mission(waypoints):
    payload = {
        "type": "MISSION_UPLOAD",
        "points": waypoints
    }
    client.connect(BROKER_IP, 1883, 60)
    client.publish(TOPIC_MISSION, json.dumps(payload))
    print(f"✅ Generated and Uploaded {len(waypoints)} Waypoints to Drone!")
    client.disconnect()

if __name__ == "__main__":
    # Example field (approx 100m box)
    field_corners = [
        {"lat": 16.506, "lng": 80.648},
        {"lat": 16.507, "lng": 80.648},
        {"lat": 16.507, "lng": 80.649},
        {"lat": 16.506, "lng": 80.649}
    ]
    
    path = generate_lawnmower_grid(field_corners)
    upload_mission(path)
