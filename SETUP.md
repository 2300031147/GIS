# 🌾 Geospatial Crop Survey System (GIS)

**An Autonomous Agricultural Monitoring & Field Verification Platform.**

Developed for the Hackathon, this system pivots from search-and-rescue to precision agriculture. It combines autonomous drone mapping, AI-driven crop health analysis, and a "Ground Truth" mobile verification tool.

---

## 🌟 System Architecture

### 1. 🖥️ Command Center Dashboard (Pi 4 Hosted)
A web-based interface for government officials and farm managers to analyze field data.
*   **Live Geospatial Map:** Shows the drone's search path and real-time crop health detections (Healthy/Diseased/Weeds).
*   **Mission Planner:** Draw a field boundary and generate an autonomous "lawnmower" grid for the Scout drone.
*   **Analytics Panel:** tracks "Total Acres Scanned" and health distribution metrics.
*   **Data Persistence:** Uses a local SQLite database for history and trend analysis.

### 2. 📱 Surveyor Mobile App (Expo / React Native)
The "Boots on the Ground" tool for field officers to verify AI findings.
*   **Navigator:** Walk to exact GPS points flagged by the drone to verify conditions.
*   **Geo-Tagged Camera:** Snap high-resolution plant photos bundled with GPS and timestamp data.
*   **Offline Sync:** Work in remote fields without signal; sync data to the Pi server once back on Wi-Fi.

### 3. 🚁 Autonomous Drone Fleet (Simulation or Jetson Orin Nano)
*   **Scout Drone:** Flies the grid and runs YOLOv8 models for real-time crop health detection.
*   **MQTT Mesh:** Communicates via Tailscale VPN for cross-network reliability.

---

## 🚀 Execution Guide

### Phase 1: Backend Deployment (Raspberry Pi 4)
1.  **Start Services:**
    ```powershell
    docker-compose up --build
    ```
    *This starts the Mosquitto MQTT Broker, Flask API, and React Dashboard.*

### Phase 2: Autonomous Drone / Master Logic
1.  **Start Drone Master:**
    ```bash
    python3 pi_scripts/agri_drone_master.py
    ```
    *This script handles MAVLink telemetry, mission uploads, and AI vision simulation.*

### Phase 3: Mobile Verification (Surveyor Phone)
1.  **Start Expo App:**
    ```bash
    cd mobile
    npx expo start
    ```
    *Scan the QR code with the Expo Go app. Use the ⚙️ Settings gear in the app to point to your laptop's Tailscale IP.*

---

## 📂 Project Structure
*   `backend/`: Flask server with SQLite integration (`data/survey.db`).
*   `frontend/`: React-based Command Center Dashboard.
*   `mobile/`: Expo Surveyor app.
*   `pi_scripts/`: Drone master control and grid generation logic.
*   `data/`: Persistent storage for geospatial logs.

---

## 🔧 Connectivity
*   **Dynamic Networking**: The dashboard and master scripts now use `window.location.hostname` or environment variables to detect your laptop/Tailscale IP automatically.
*   **Local Web Access:** `http://localhost:3000`
*   **API Access:** `http://localhost:5000/api/history`
