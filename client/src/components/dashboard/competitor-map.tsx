import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    L: any;
  }
}

interface CompetitorMapProps {
  selectedRegions?: string[];
  selectedDivisions?: string[];
  selectedLocations?: string[];
}

export function CompetitorMap({ 
  selectedRegions = [], 
  selectedDivisions = [], 
  selectedLocations = [] 
}: CompetitorMapProps = {}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  
  // Build query params for filtering
  const queryParams = new URLSearchParams();
  if (selectedRegions.length > 0) queryParams.append('regions', selectedRegions.join(','));
  if (selectedDivisions.length > 0) queryParams.append('divisions', selectedDivisions.join(','));
  if (selectedLocations.length > 0) queryParams.append('locations', selectedLocations.join(','));
  const queryString = queryParams.toString();
  
  const { data: competitors, isLoading } = useQuery({
    queryKey: ["/api/competitors", selectedRegions, selectedDivisions, selectedLocations],
    queryFn: async () => {
      const response = await fetch(`/api/competitors${queryString ? '?' + queryString : ''}`);
      if (!response.ok) throw new Error('Failed to fetch competitors');
      return response.json();
    }
  });

  useEffect(() => {
    let mounted = true;
    
    const initializeMap = async () => {
      if (!mapRef.current || !mounted) return;
      
      // Load Leaflet
      if (!window.L) {
        const leafletScript = document.createElement('script');
        leafletScript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        leafletScript.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
        leafletScript.crossOrigin = '';
        
        const leafletCSS = document.createElement('link');
        leafletCSS.rel = 'stylesheet';
        leafletCSS.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        leafletCSS.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        leafletCSS.crossOrigin = '';
        
        document.head.appendChild(leafletCSS);
        document.head.appendChild(leafletScript);
        
        await new Promise((resolve) => {
          leafletScript.onload = resolve;
        });
      }
      
      if (!window.L || !mounted) return;
      
      // Clear any existing map
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      if (!mapRef.current || !mounted) return;
      
      // Clear the container
      mapRef.current.innerHTML = '';
      
      try {
        // Create new map
        mapInstanceRef.current = window.L.map(mapRef.current, {
          center: [38.2527, -85.7585],
          zoom: 11,
          scrollWheelZoom: true
        });
        
        // Add tile layer
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 18
        }).addTo(mapInstanceRef.current);
        
        if (!mounted) return;
        
        // Add markers
        addMarkers();
        
      } catch (error) {
        console.log('Map initialization error:', error);
      }
    };
    
    const addMarkers = () => {
      if (!mapInstanceRef.current || !window.L || !competitors || !mounted) return;
      
      const competitorData = competitors as any;
      if (!competitorData?.items) return;
      
      // Get current property based on selected location or use first one
      const currentLocation = competitorData.currentLocation || {
        name: "Selected Location",
        lat: competitorData.items[0]?.propertyLat || 38.2527,
        lng: competitorData.items[0]?.propertyLng || -85.7585,
        address: competitorData.items[0]?.propertyAddress || "Senior Living Community"
      };
      
      // Current property marker
      const currentProperty = {
        name: currentLocation.name,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        rates: { "Studio": 3175, "One Bedroom": 4200, "Two Bedroom": 5100, "Memory Care": 4800 },
        avgCareRate: 775,
        address: currentLocation.address
      };
      
      // Current property icon
      const currentIcon = window.L.divIcon({
        html: `<div style="width: 30px; height: 30px; background-color: #2563eb; border: 4px solid white; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.6);"></div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });
      
      const currentMarker = window.L.marker([currentProperty.lat, currentProperty.lng], {
        icon: currentIcon
      }).addTo(mapInstanceRef.current);
      
      const currentRates = Object.entries(currentProperty.rates)
        .map(([roomType, rate]) => `${roomType}: $${rate}`)
        .join('<br>');
      
      currentMarker.bindPopup(`
        <div style="color: #1f2937; font-family: sans-serif; line-height: 1.4;">
          <div style="background: #2563eb; color: white; padding: 8px; margin: -8px -8px 8px -8px; border-radius: 4px 4px 0 0;">
            <b style="font-size: 14px;">${currentProperty.name}</b>
            <div style="font-size: 11px; opacity: 0.9;">Our Property</div>
          </div>
          <div style="font-size: 12px;">
            <div style="margin-bottom: 8px;"><b>Room Rates:</b><br>${currentRates}</div>
            <div style="margin-bottom: 8px;"><b>Avg Care:</b> $${currentProperty.avgCareRate}</div>
            <div style="font-size: 11px; color: #6b7280;">${currentProperty.address}</div>
          </div>
        </div>
      `);
      
      // Competitor markers
      competitorData.items.forEach((competitor: any) => {
        if (!competitor.lat || !competitor.lng || !mounted) return;
        
        // Color based on A/B/C rating
        const getRatingColor = (rating: string) => {
          switch (rating?.toUpperCase()) {
            case 'A': return '#22c55e'; // Green for A rating
            case 'B': return '#f59e0b'; // Amber for B rating  
            case 'C': return '#ef4444'; // Red for C rating
            default: return '#6b7280'; // Gray for no rating
          }
        };
        
        const color = getRatingColor(competitor.rating);
        const size = competitor.rating === 'A' ? '26px' : '24px';
        
        const competitorIcon = window.L.divIcon({
          html: `<div style="width: ${size}; height: ${size}; background-color: ${color}; border: 3px solid white; border-radius: 50%; box-shadow: 0 3px 8px rgba(0,0,0,0.6);"></div>`,
          iconSize: [parseInt(size) + 6, parseInt(size) + 6],
          iconAnchor: [(parseInt(size) + 6) / 2, (parseInt(size) + 6) / 2]
        });
        
        const marker = window.L.marker([competitor.lat, competitor.lng], {
          icon: competitorIcon
        }).addTo(mapInstanceRef.current);
        
        const careRateDiff = competitor.avgCareRate ? (competitor.avgCareRate - currentProperty.avgCareRate) : 0;
        const careRate = competitor.avgCareRate 
          ? `Avg Care: $${competitor.avgCareRate} (${careRateDiff > 0 ? '+' : ''}$${careRateDiff})`
          : 'Avg Care: Not available';

        // Format room rates from the rates object
        let roomRatesHtml = 'No room rates provided';
        if (competitor.rates && typeof competitor.rates === 'object') {
          const rates = [];
          // Check for both camelCase and proper case keys
          if (competitor.rates.Studio || competitor.rates.studio) {
            rates.push(`Studio: $${competitor.rates.Studio || competitor.rates.studio}`);
          }
          if (competitor.rates['One Bedroom'] || competitor.rates.oneBedroom) {
            rates.push(`One Bedroom: $${competitor.rates['One Bedroom'] || competitor.rates.oneBedroom}`);
          }
          if (competitor.rates['Two Bedroom'] || competitor.rates.twoBedroom) {
            rates.push(`Two Bedroom: $${competitor.rates['Two Bedroom'] || competitor.rates.twoBedroom}`);
          }
          if (competitor.rates['Memory Care'] || competitor.rates.memoryCare) {
            rates.push(`Memory Care: $${competitor.rates['Memory Care'] || competitor.rates.memoryCare}`);
          }
          
          if (rates.length > 0) {
            roomRatesHtml = rates.join('<br>');
          }
        }

        const rating = competitor.rating ? `${competitor.rating} rating` : 'No rating';

        const searchTerm = competitor.address || `${competitor.name} Louisville KY`;
        const encodedAddress = encodeURIComponent(searchTerm);
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        const directionsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(currentProperty.address)}/${encodedAddress}`;

        marker.bindPopup(`
          <div style="color: #1f2937; font-family: sans-serif; line-height: 1.4; min-width: 250px;">
            <div style="background: ${color}; color: white; padding: 8px; margin: -8px -8px 8px -8px; border-radius: 4px 4px 0 0;">
              <b style="font-size: 14px;">${competitor.name}</b>
              <div style="font-size: 11px; opacity: 0.9;">Competitor • ${rating}</div>
            </div>
            <div style="font-size: 12px;">
              <div style="margin-bottom: 8px;"><b>💰 ${careRate}</b></div>
              <div style="margin-bottom: 8px;"><b>🏠 Room Rates:</b><br>${roomRatesHtml}</div>
              <div style="margin-top: 10px;">
                <a href="${googleMapsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px; margin-right: 10px;">📍 View on Google</a>
                <a href="${directionsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px;">🚗 Directions</a>
              </div>
            </div>
          </div>
        `);
      });
      
      // Adjust map to fit all markers
      if (competitorData.items.length > 0 && mapInstanceRef.current) {
        const bounds = window.L.latLngBounds(
          [[currentProperty.lat, currentProperty.lng]]
        );
        competitorData.items.forEach((comp: any) => {
          if (comp.lat && comp.lng) {
            bounds.extend([comp.lat, comp.lng]);
          }
        });
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
      
      console.log(`Added ${competitorData.items.length + 1} markers to map`);
    };
    
    // Initialize when competitors data is available
    if (competitors) {
      initializeMap();
    }
    
    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [competitors]);

  if (isLoading) {
    return (
      <div className="dashboard-card h-96 flex items-center justify-center">
        <div className="text-[var(--dashboard-muted)]">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-map-title">
            Competitor Map {selectedLocations.length === 1 ? `- ${selectedLocations[0]}` : selectedLocations.length > 1 ? `- ${selectedLocations.length} Locations` : ''}
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            {competitors?.items?.length || 0} competitors found • Top 3 shown per location
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-bg)]"
            data-testid="button-map-fullscreen"
          >
            <Maximize2 className="h-5 w-5" />
          </Button>
        </div>
      </div>
      
      <div 
        ref={mapRef}
        className="h-96 w-full bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-lg relative"
        data-testid="map-container"
        style={{ minHeight: '400px', height: '400px' }}
      >
        <div className="absolute inset-0 flex items-center justify-center text-[var(--dashboard-muted)]">
          <div className="text-center">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Loading interactive map...</p>
          </div>
        </div>
      </div>
    </div>
  );
}