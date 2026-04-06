-- GIS Survey Data Schema
-- Used by backend/server.py

CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP, -- ISO8601 format
    drone_id TEXT NOT NULL,                  -- 'scout', 'delivery', or 'mobile'
    lat REAL NOT NULL,                       -- WGS84 Latitude
    lon REAL NOT NULL,                       -- WGS84 Longitude
    status TEXT NOT NULL,                    -- 'Healthy', 'Diseased', 'Weed', 'Verification'
    crop_type TEXT,                          -- 'Corn', 'Soybean', 'Wheat', etc.
    confidence REAL DEFAULT 0.0,             -- AI confidence score (0-1)
    image_url TEXT,                          -- Path to local or remote image
    notes TEXT                               -- Field officer observations
);

-- Index for geospatial lookups (mocked, but good for performance)
CREATE INDEX IF NOT EXISTS idx_coords ON detections (lat, lon);
CREATE INDEX IF NOT EXISTS idx_timestamp ON detections (timestamp);
