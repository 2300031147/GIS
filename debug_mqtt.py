import paho.mqtt.client as mqtt
import time
import sys

# CONFIG
BROKER = "localhost" # Connect to the Docker Broker exposed on port 1883
TOPIC = "gis/#"    # Listen to EVERYTHING

print("=========================================")
print("🕵️  GIS MQTT SNOOPER")
print("=========================================")

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"✅ Connected to Broker at {BROKER}")
        client.subscribe(TOPIC)
        print(f"👂 Listening on {TOPIC}...")
    else:
        print(f"❌ Connection Failed with code {rc}")

def on_message(client, userdata, msg):
    try:
        print(f"📩 [{msg.topic}]: {msg.payload.decode()}")
    except:
        print(f"📩 [{msg.topic}]: (Binary/Error)")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

print(f"🔌 Connecting to {BROKER}:1883...")
try:
    client.connect(BROKER, 1883, 60)
    client.loop_forever()
except Exception as e:
    print(f"❌ FAILED to connect: {e}")
    print("   Make sure Docker is running: docker-compose up")
