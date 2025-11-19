/**
 * Geocoding utility to convert addresses to lat/lng coordinates
 * Uses a simple approximation for demo purposes
 * In production, this would use Google Maps Geocoding API or similar
 */

interface Location {
  lat: number;
  lng: number;
}

/**
 * Simple geocoding function - estimates coordinates based on address
 * For production, replace with actual geocoding API
 */
export async function geocodeAddress(address: string | null): Promise<Location | null> {
  if (!address) return null;
  
  // For demo purposes, generate approximate coordinates based on address hash
  // In production, use Google Maps Geocoding API, Mapbox, or similar
  const hash = simpleHash(address);
  
  // Generate coordinates roughly in the US (lat: 25-50, lng: -125 to -65)
  const lat = 35 + (hash % 15);
  const lng = -95 + (hash % 30);
  
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * Returns distance in miles
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 10) / 10; // Round to 1 decimal
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Find nearest location from a list
 */
export function findNearestLocation(
  targetLat: number,
  targetLng: number,
  locations: Array<{ name: string; lat: number; lng: number }>
): { name: string; distance: number } | null {
  if (!locations || locations.length === 0) return null;
  
  let nearest = locations[0];
  let minDistance = calculateDistance(targetLat, targetLng, nearest.lat, nearest.lng);
  
  for (const loc of locations) {
    const distance = calculateDistance(targetLat, targetLng, loc.lat, loc.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = loc;
    }
  }
  
  return {
    name: nearest.name,
    distance: minDistance
  };
}
