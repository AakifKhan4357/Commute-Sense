from contextlib import asynccontextmanager
from typing import List, Optional
import os
import pandas as pd
import uvicorn
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Initialize models
model_boarding = xgb.XGBRegressor()
model_alighting = xgb.XGBRegressor()

# Load models from .json (or fallback to .pkl if present)
try:
    if os.path.exists("model_boarding.json"):
        model_boarding.load_model("model_boarding.json")
        model_alighting.load_model("model_alighting.json")
        print("Models loaded successfully from .json files.")
    elif os.path.exists("model_boarding.pkl"):
        import joblib
        model_boarding = joblib.load("model_boarding.pkl")
        model_alighting = joblib.load("model_alighting.pkl")
        print("Models loaded successfully from .pkl files.")
    else:
        print("Warning: Model files not found. Ensure .json or .pkl model files are in the working directory.")
except Exception as e:
    print(f"Error loading models: {e}")

# Load stops coordinate mapping from CSV
stops_df = pd.DataFrame(columns=["place_name", "latitude", "longitude"])
for filename in ["stops.csv", "bus_stops.csv"]:
    if os.path.exists(filename):
        stops_df = pd.read_csv(filename)
        break
else:
    csv_files = [f for f in os.listdir(".") if f.endswith(".csv")]
    if csv_files:
        stops_df = pd.read_csv(csv_files[0])

stops_df["place_name_clean"] = stops_df["place_name"].astype(str).str.strip().str.lower()
stops_map = stops_df.drop_duplicates("place_name_clean").set_index("place_name_clean")[["latitude", "longitude"]].to_dict(orient="index")


# Optional ngrok lifecycle (will not crash if token is missing or local dev is used)
@asynccontextmanager
async def lifespan(app: FastAPI):
    tunnel = None
    if os.getenv("USE_NGROK", "false").lower() == "true":
        try:
            from pyngrok import ngrok
            tunnel = ngrok.connect(8000)
            print(f"\n>>> Public Ngrok URL: {tunnel.public_url}\n")
        except Exception as err:
            print(f"\nNgrok tunnel could not be started: {err}\nRunning on local port 8000 only.\n")
    yield
    if tunnel:
        from pyngrok import ngrok
        print("\nClosing ngrok tunnel...")
        ngrok.disconnect(tunnel.public_url)
        ngrok.kill()


app = FastAPI(
    title="CommuteSense API",
    description="Predict bus occupancy and next boardable bus",
    lifespan=lifespan,
)

# CORS Middleware to allow requests from Vite (http://localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Schemas
class IncomingBusFeatures(BaseModel):
    line_id: int
    stop_id: int
    stop_position: int
    day_of_week: int
    hour: int
    minute: int
    stop_name: Optional[str] = None
    dest_name: Optional[str] = None
    stop_lat: Optional[float] = None
    stop_lon: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lon: Optional[float] = None
    osrm_traversal_duration_sec: float
    osrm_distance_m: float
    vehicle_seats: int


class IncomingBusData(BaseModel):
    bus_id: str
    eta_sec: int
    capacity: int
    current_load: int
    features: IncomingBusFeatures


class PredictionResult(BaseModel):
    bus_id: str
    arrival_time_sec: int
    predicted_boardings: float
    predicted_alightings: float
    projected_occupancy: float
    available_space: float
    is_boardable: bool


class NextBoardableBusResponse(BaseModel):
    all_bus_projections: List[PredictionResult]
    next_boardable_bus: PredictionResult | None


def calculate_next_boardable_bus_api(incoming_buses_data_list: List[IncomingBusData]):
    results = []
    # Explicit feature ordering to match XGBoost training columns
    feature_cols = [
        "line_id",
        "stop_id",
        "stop_position",
        "day_of_week",
        "hour",
        "minute",
        "stop_lat",
        "stop_lon",
        "dest_lat",
        "dest_lon",
        "osrm_traversal_duration_sec",
        "osrm_distance_m",
        "vehicle_seats",
    ]

    for bus_data in incoming_buses_data_list:
        features_dict = (
            bus_data.features.model_dump()
            if hasattr(bus_data.features, "model_dump")
            else bus_data.features.dict()
        )

        # Resolve stop coordinates from place name if missing
        if features_dict.get("stop_name"):
            key = str(features_dict["stop_name"]).strip().lower()
            if key in stops_map:
                features_dict["stop_lat"] = stops_map[key]["latitude"]
                features_dict["stop_lon"] = stops_map[key]["longitude"]
            else:
                raise HTTPException(status_code=404, detail=f"Stop name '{features_dict['stop_name']}' not found in stops CSV.")

        # Resolve destination coordinates from place name if missing
        if features_dict.get("dest_name"):
            key = str(features_dict["dest_name"]).strip().lower()
            if key in stops_map:
                features_dict["dest_lat"] = stops_map[key]["latitude"]
                features_dict["dest_lon"] = stops_map[key]["longitude"]
            else:
                raise HTTPException(status_code=404, detail=f"Destination name '{features_dict['dest_name']}' not found in stops CSV.")

        features_df = pd.DataFrame([features_dict])[feature_cols]

        pred_board = int(round(max(0.0, float(model_boarding.predict(features_df)[0]))))
        pred_alight = int(round(max(0.0, float(model_alighting.predict(features_df)[0]))))
        pred_alight = min(int(bus_data.current_load), pred_alight)

        capacity = int(bus_data.capacity)
        current_load = int(bus_data.current_load)

        projected_occupancy = current_load + pred_board - pred_alight
        projected_occupancy = max(0, min(capacity, projected_occupancy))
        available_space = max(0, capacity - projected_occupancy)

        is_boardable = available_space > 0

        results.append(
            {
                "bus_id": bus_data.bus_id,
                "arrival_time_sec": bus_data.eta_sec,
                "predicted_boardings": pred_board,
                "predicted_alightings": pred_alight,
                "projected_occupancy": projected_occupancy,
                "available_space": available_space,
                "is_boardable": is_boardable,
            }
        )

    results.sort(key=lambda x: x["arrival_time_sec"])
    next_boardable = next((b for b in results if b["is_boardable"]), None)
    return results, next_boardable


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "CommuteSense API",
        "docs_url": "/docs",
    }


@app.post("/predict-bus-space", response_model=NextBoardableBusResponse)
def predict_bus_space(incoming_buses: List[IncomingBusData]):
    all_bus_projections, next_boardable_bus = calculate_next_boardable_bus_api(incoming_buses)
    return {
        "all_bus_projections": all_bus_projections,
        "next_boardable_bus": next_boardable_bus,
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)