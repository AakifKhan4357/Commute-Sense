import React, { useState, useEffect } from "react";
import {
  Bus,
  MapPin,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  Navigation,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

// Points to local FastAPI backend
const API_BASE_URL = "http://127.0.0.1:8000";

export default function App() {
  // Origin & Destination state (defaulted to close coordinates so OSRM routing succeeds)
  const [origin, setOrigin] = useState({
    lat: "17.3850",
    lon: "78.4867",
    name: "Current Location",
  });
  const [dest, setDest] = useState({
    lat: "17.4401",
    lon: "78.3489",
    name: "Destination",
  });

  // UI state
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState(null);
  const [nextBus, setNextBus] = useState(null);
  const [routeStats, setRouteStats] = useState(null);

  useEffect(() => {
    handleUseCurrentLocation();
  }, []);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Geolocation is not supported by your browser.");
      return;
    }
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLat = position.coords.latitude.toFixed(4);
        const userLon = position.coords.longitude.toFixed(4);
        setOrigin({
          lat: userLat,
          lon: userLon,
          name: "Current GPS Location",
        });
        // Set nearby default destination (roughly 5-6 km away)
        setDest({
          lat: (parseFloat(userLat) + 0.045).toFixed(4),
          lon: (parseFloat(userLon) + 0.035).toFixed(4),
          name: "Downstream Stop",
        });
        setLoadingLocation(false);
      },
      (err) => {
        setErrorMsg("Unable to retrieve GPS: " + err.message);
        setLoadingLocation(false);
      },
      { timeout: 8000 }
    );
  };

  // Query public OSRM API for travel time and distance
  const fetchOsrmMetrics = async (oLat, oLon, dLat, dLon) => {
    const url = `https://router.project-osrm.org/route/v1/driving/${oLon},${oLat};${dLon},${dLat}?overview=false`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        return {
          durationSec: data.routes[0].duration,
          distanceM: data.routes[0].distance,
        };
      }
    } catch {
      // Fallback estimate if OSRM is unreachable
    }
    return { durationSec: 900.0, distanceM: 6500.0 };
  };

  const runPrediction = async (e) => {
    e?.preventDefault();
    setLoadingPrediction(true);
    setErrorMsg("");

    try {
      const oLat = parseFloat(origin.lat);
      const oLon = parseFloat(origin.lon);
      const dLat = parseFloat(dest.lat);
      const dLon = parseFloat(dest.lon);

      // 1. Fetch traversal metrics from OSRM
      const osrm = await fetchOsrmMetrics(oLat, oLon, dLat, dLon);
      setRouteStats(osrm);

      // 2. Prepare dynamic time parameters
      const now = new Date();
      const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0, Sunday = 6
      const hour = now.getHours();
      const minute = now.getMinutes();

      // 3. Assemble simulated incoming buses matching Pydantic schema
      const simulatedIncomingBuses = [
        {
          bus_id: "BUS-Line-73A",
          eta_sec: 180,
          capacity: 60,
          current_load: 54, // Crowded bus
          features: {
            line_id: 73,
            stop_id: 101,
            stop_position: 4,
            day_of_week: dayOfWeek,
            hour: hour,
            minute: minute,
            stop_lat: oLat,
            stop_lon: oLon,
            dest_lat: dLat,
            dest_lon: dLon,
            osrm_traversal_duration_sec: osrm.durationSec,
            osrm_distance_m: osrm.distanceM,
            vehicle_seats: 60,
          },
        },
        {
          bus_id: "BUS-Line-73B",
          eta_sec: 420,
          capacity: 60,
          current_load: 32, // Moderately occupied
          features: {
            line_id: 73,
            stop_id: 101,
            stop_position: 4,
            day_of_week: dayOfWeek,
            hour: hour,
            minute: minute,
            stop_lat: oLat,
            stop_lon: oLon,
            dest_lat: dLat,
            dest_lon: dLon,
            osrm_traversal_duration_sec: osrm.durationSec,
            osrm_distance_m: osrm.distanceM,
            vehicle_seats: 60,
          },
        },
        {
          bus_id: "BUS-Line-105",
          eta_sec: 780,
          capacity: 75,
          current_load: 20, // High capacity available
          features: {
            line_id: 105,
            stop_id: 101,
            stop_position: 2,
            day_of_week: dayOfWeek,
            hour: hour,
            minute: minute,
            stop_lat: oLat,
            stop_lon: oLon,
            dest_lat: dLat,
            dest_lon: dLon,
            osrm_traversal_duration_sec: osrm.durationSec,
            osrm_distance_m: osrm.distanceM,
            vehicle_seats: 75,
          },
        },
      ];

      // 4. Send request to FastAPI backend
      const response = await fetch(`${API_BASE_URL}/predict-bus-space`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simulatedIncomingBuses),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      setResults(data.all_bus_projections);
      setNextBus(data.next_boardable_bus);
    } catch (err) {
      setErrorMsg(
        err.message.includes("Failed to fetch")
          ? "Cannot connect to backend. Make sure 'python main.py' is running on port 8000."
          : err.message
      );
    } finally {
      setLoadingPrediction(false);
    }
  };

  const formatSeconds = (sec) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = sec % 60;
    return `${mins}m ${remainingSec}s`;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 antialiased p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-6 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-indigo-600 rounded-lg">
                <Bus className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">CommuteSense</h1>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Real-time load forecasting & boardable bus arrivals
            </p>
          </div>

          <button
            onClick={runPrediction}
            disabled={loadingPrediction}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/50 text-white px-5 py-2.5 rounded-lg font-medium transition-all shadow-md active:scale-95"
          >
            <RefreshCw
              className={`w-4 h-4 ${loadingPrediction ? "animate-spin" : ""}`}
            />
            <span>{loadingPrediction ? "Forecasting..." : "Scan Buses"}</span>
          </button>
        </header>

        {/* Error Alert */}
        {errorMsg && (
          <div className="flex items-center space-x-3 p-4 bg-red-950/50 border border-red-800 text-red-300 rounded-xl">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" />
            <span className="text-sm font-medium">{errorMsg}</span>
          </div>
        )}

        {/* Origin / Destination Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Current Stop / Origin
              </span>
              <button
                onClick={handleUseCurrentLocation}
                disabled={loadingLocation}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
              >
                <Navigation className="w-3 h-3" />
                {loadingLocation ? "Locating..." : "Use GPS"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-400">Latitude</label>
                <input
                  type="text"
                  value={origin.lat}
                  onChange={(e) => setOrigin({ ...origin, lat: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Longitude</label>
                <input
                  type="text"
                  value={origin.lon}
                  onChange={(e) => setOrigin({ ...origin, lon: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-3">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Destination Coordinates
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-400">Latitude</label>
                <input
                  type="text"
                  value={dest.lat}
                  onChange={(e) => setDest({ ...dest, lat: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Longitude</label>
                <input
                  type="text"
                  value={dest.lon}
                  onChange={(e) => setDest({ ...dest, lon: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Route Details */}
        {routeStats && (
          <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-slate-800/40 border border-slate-700/40 rounded-lg text-xs text-slate-300">
            <span>
              OSRM Distance:{" "}
              <strong className="text-slate-100">
                {(routeStats.distanceM / 1000).toFixed(2)} km
              </strong>
            </span>
            <span>•</span>
            <span>
              Drive Traversal Estimate:{" "}
              <strong className="text-slate-100">
                {formatSeconds(Math.round(routeStats.durationSec))}
              </strong>
            </span>
          </div>
        )}

        {/* Recommended "Next Boardable Bus" */}
        {nextBus ? (
          <div className="p-5 bg-gradient-to-r from-emerald-950/40 to-slate-800/80 border border-emerald-500/30 rounded-2xl shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <h2 className="text-emerald-400 font-semibold text-xs uppercase tracking-wide">
                Next Boardable Bus Recommendation
              </h2>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 mt-2">
              <div>
                <div className="text-3xl font-extrabold text-white">
                  {nextBus.bus_id}
                </div>
                <div className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  Arriving in{" "}
                  <span className="font-semibold text-slate-200">
                    {formatSeconds(nextBus.arrival_time_sec)}
                  </span>
                </div>
              </div>

              <div className="flex gap-4 sm:gap-6 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <div>
                  <div className="text-xs text-slate-400">Available Space</div>
                  <div className="text-xl font-bold text-emerald-400">
                    ~{nextBus.available_space} seats
                  </div>
                </div>
                <div className="border-l border-slate-800 pl-4">
                  <div className="text-xs text-slate-400">Projected Load</div>
                  <div className="text-xl font-bold text-slate-200">
                    {nextBus.projected_occupancy}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : results ? (
          <div className="p-5 bg-amber-950/30 border border-amber-800/40 rounded-2xl flex items-center gap-3">
            <XCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="text-sm text-amber-200">
              No boardable buses found. All incoming vehicles are predicted to be at capacity.
            </div>
          </div>
        ) : null}

        {/* All Incoming Buses Table */}
        {results && (
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-700/60 flex items-center justify-between">
              <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" /> All Incoming Buses
              </h3>
              <span className="text-xs text-slate-400">
                Sorted by arrival time
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Bus Identifier</th>
                    <th className="px-4 py-3">ETA</th>
                    <th className="px-4 py-3">Pred. On / Off</th>
                    <th className="px-4 py-3">Projected Load</th>
                    <th className="px-4 py-3">Free Space</th>
                    <th className="px-4 py-3">Boardable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {results.map((bus) => (
                    <tr
                      key={bus.bus_id}
                      className={`hover:bg-slate-700/20 transition-colors ${
                        nextBus?.bus_id === bus.bus_id ? "bg-emerald-950/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-100 flex items-center gap-2">
                        {bus.bus_id}
                        {nextBus?.bus_id === bus.bus_id && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30">
                            BEST
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {formatSeconds(bus.arrival_time_sec)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        +{bus.predicted_boardings} / -{bus.predicted_alightings}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-200">
                        {bus.projected_occupancy}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-100">
                        {bus.available_space}
                      </td>
                      <td className="px-4 py-3">
                        {bus.is_boardable ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" /> Full
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}