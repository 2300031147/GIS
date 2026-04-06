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

### Phase 2: AI Survey Simulation
1.  **Run Simulation:**
    ```bash
    python3 pi_scripts/crop_detect_sim.py
    ```
    *This simulates a drone detecting different crop conditions and publishing data to the backend.*

### Phase 3: Mobile Verification (Surveyor Phone)
1.  **Start Expo App:**
    ```bash
    cd mobile
    npx expo start
    ```
    *Scan the QR code with the Expo Go app to start field verification.*

---

## 📂 Project Structure
*   `backend/`: Flask server with SQLite integration (`data/survey.db`).
*   `dashboard/` (frontend): React-based Command Center.
*   `mobile/`: Expo Surveyor app.
*   `pi_scripts/`: Drone control and simulated detection logic.
*   `data/`: Persistent storage for geospatial logs.

---

## 🔧 Connectivity
*   **Broker IP:** Ensure your Tailscale IP is updated in `App.js` and `pi_scripts/`.
*   **Local Web Access:** `http://localhost:3000`
*   **API Access:** `http://localhost:5000/api/history`
