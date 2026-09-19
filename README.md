CommuteSense: Predictive Bus Occupancy & Next Boardable Bus Detection

Real-time transit passenger load forecasting and boardable bus arrival recommendations.

📌 Problem & Overview

Traditional transit aggregators (e.g., Google Maps, Transit, Citymapper) estimate vehicle arrival times (ETA) but have no visibility into passenger occupancy. Commuters regularly wait for arriving buses only to find them overflowing and unable to board.

CommuteSense solves this by predicting passenger turnover (boardings vs. alightings) before a vehicle reaches the curb. Using a dual-regressor machine learning model integrated with live road traversal metrics, CommuteSense informs riders not just when a bus will arrive, but which incoming bus actually has space to board.

🏗️ Architecture

[User Browser: GPS Geolocation & Terminus Destination]
                          │
                          ▼
            ┌────────────────────────────┐
            │   React 18 + Tailwind CSS  │
            │     Frontend Dashboard     │
            └────────────────────────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
┌──────────────────┐          ┌───────────────────────────┐
│  OSRM Public API │          │      FastAPI Backend      │
│ Driving Duration │          │   POST /predict-bus-space │
│   and Distance   │          │       (Port 8000)         │
└──────────────────┘          └───────────────────────────┘
         │                                 │
         └────────────────┬────────────────┘
                          ▼
        ┌────────────────────────────────────┐
        │  13-Dimensional Feature Alignment  │
        │  [line_id, stop_lat, OSRM, ...]   │
        └────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   ┌──────────────────────┐ ┌──────────────────────┐
   │ XGBoost Boarding Reg │ │ XGBoost Alighting Reg│
   │ (Predicts On-Board)  │ │ (Predicts Drop-Off)  │
   └──────────────────────┘ └──────────────────────┘
              │                       │
              └───────────┬───────────┘
                          ▼
        ┌────────────────────────────────────┐
        │     Dynamic Capacity Logic:        │
        │   Occ = Load + Pred_On - Pred_Off  │
        │      Space = Capacity - Occ        │
        │    Is_Boardable = (Space > 0)      │
        └────────────────────────────────────┘
                          │
                          ▼
        [Live Sorted Projections & Best Card]


🚀 Key Features

Dual XGBoost Inference: Separate gradient-boosted regressors predict boarding surges and alighting drops per stop in under $15\text{ ms}$.

Dynamic Capacity Scoring: Calculates net remaining space ($Load_{\text{current}} + \hat{y}_{\text{boarding}} - \hat{y}_{\text{alighting}}$) to flag boardable vehicles.

Routing-Aware Covariates: Integrates Open Source Routing Machine (OSRM) distance and traversal duration to track passenger discharge along corridors.

Smart UI Dashboard: Live GPS tracking (navigator.geolocation) with a "Next Boardable Bus" recommendation card and capacity matrix.

📊 Model Specifications

Algorithm: Dual Extreme Gradient Boosting Regressors (xgboost.XGBRegressor)

Tree Method: hist (optimized split evaluation)

Hyperparameters: $n_{\text{estimators}} = 300$, $\eta = 0.05$, $\text{max\_depth} = 6$, $\text{subsample} = 0.8$, $\text{colsample\_bytree} = 0.8$

Quantitative Metrics (Test Split: 20%):

Formula: 

$$\text{MAE} = \frac{1}{n}\sum_{i=1}^{n} \vert{}y_i - \hat{y}_i\vert{}$$

Boarding MAE: $5.76\text{ passengers}$

Alighting MAE: $5.37\text{ passengers}$

13 Feature Dimensions: line_id, stop_id, stop_position, day_of_week, hour, minute, stop_lat, stop_lon, dest_lat, dest_lon, osrm_traversal_duration_sec, osrm_distance_m, vehicle_seats.

📁 Repository Structure

CommuteSense/
├── commute-sense-frontend/    # React 18 + Tailwind CSS client interface
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── main.py                    # FastAPI service & model scoring pipeline
├── model_boarding.json        # Pretrained XGBoost weights (boardings)
├── model_alighting.json       # Pretrained XGBoost weights (alightings)
├── requirements.txt           # Python dependencies
├── .gitignore
└── README.md


🛠️ Setup & Installation

Prerequisites

Python 3.10+

Node.js 18+ and npm

1. Backend Setup

# Clone the repository
git clone https://github.com/<your-org-or-username>/CommuteSense.git
cd CommuteSense

# Create and activate virtual environment
python -m venv venv
# On Linux/macOS:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload


The API will be operational at http://localhost:8000. Interactive OpenAPI documentation is accessible at http://localhost:8000/docs.

2. Frontend Setup

cd commute-sense-frontend

# Install dependencies
npm install

# Run the development server
npm run dev


Open http://localhost:5173 in your browser to view the interface.

🔌 API Reference

POST /predict-bus-space

Accepts incoming bus batch telemetry and returns boardability predictions.

Sample Request Body:

{
  "stop_lat": 17.3850,
  "stop_lon": 78.4867,
  "dest_lat": 17.4401,
  "dest_lon": 78.3489,
  "buses": [
    {
      "bus_id": "BUS-Line-73A",
      "line_id": 73,
      "stop_id": 104,
      "stop_position": 12,
      "current_load": 54,
      "vehicle_seats": 60,
      "eta_seconds": 180
    }
  ]
}


Sample Response:

{
  "status": "success",
  "predictions": [
    {
      "bus_id": "BUS-Line-73A",
      "eta_min": 3.0,
      "pred_boarding": 2.8,
      "pred_alighting": 10.5,
      "projected_occupancy": 46.3,
      "free_space": 13.7,
      "is_boardable": true,
      "status": "RECOMMENDED (BEST)"
    }
  ]
}


🗺️ Roadmap

[x] Dual XGBoost offline training & sequential delta engineering

[x] FastAPI inference backend with schema validation

[x] React client dashboard with OSRM telemetry

[ ] Direct GTFS-RT streaming ingestion (Vehicle Positions & Trip Updates)

[ ] Benchmarking against Temporal Fusion Transformers (TFT) and BiLSTMs

[ ] Weather API covariate integration (precipitation/temperature impact)

[ ] Dockerized deployment on Google Cloud Run