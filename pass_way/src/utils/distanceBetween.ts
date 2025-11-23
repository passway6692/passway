import NodeCache from "node-cache";
import { DISTANCE_CACHE_TIME } from "./constants";
import { config } from "../libs/env";
import axios from "axios";

const cache = new NodeCache({ stdTTL: DISTANCE_CACHE_TIME });

export async function calculateDistance({
  fromLat,
  fromLng,
  toLat,
  toLng,
}: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}) {
  const cacheKey = `${fromLat}_${fromLng}_${toLat}_${toLng}`;
  const cachedResult = cache.get<{ distance: number; duration: number }>(cacheKey);

  if (cachedResult) return cachedResult;

  const apiKey = config.GOOGLE_MAPS_API_KEY;

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=driving&language=ar&departure_time=now&traffic_model=best_guess&key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== "OK" || !data.routes?.length) {
      throw new Error("Failed to fetch directions data from Google Maps API");
    }

    const leg = data.routes[0].legs[0];

    const distanceKm = leg.distance.value / 1000;
    const durationMin = leg.duration_in_traffic
      ? leg.duration_in_traffic.value / 60
      : leg.duration.value / 60;

    const result = {
      distance: parseFloat(distanceKm.toFixed(2)),
      duration: parseFloat(durationMin.toFixed(2)),
    };

    cache.set(cacheKey, result);

    return result;
  } catch (error) {
    console.error("Error calculating distance:", error);
    throw new Error("Failed to calculate distance");
  }
}
