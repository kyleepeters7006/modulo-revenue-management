import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    L: any;
  }
}

export function CompetitorMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  
  const { data: competitors, isLoading } = useQuery({
    queryKey: ["/api/competitors"]
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
      
      // Current property marker
      const currentProperty = {
        name: "Sunset Manor Senior Living",
        lat: 38.2527,
        lng: -85.7585,
        rates: { "Studio": 3175, "One Bedroom": 4200, "Two Bedroom": 5100, "Memory Care": 4800 },
        avgCareRate: 775,
        address: "1234 Main St, Louisville, KY 40207"
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
        
        const isTopCompetitor = competitor.avgCareRate && competitor.avgCareRate > 900;
        const color = isTopCompetitor ? '#f97316' : '#dc2626';
        const size = isTopCompetitor ? '26px' : '24px';
        
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

        const searchTerm = competitor.address || `${competitor.name} Louisville KY`;
        const encodedAddress = encodeURIComponent(searchTerm);
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        const directionsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(currentProperty.address)}/${encodedAddress}`;

        marker.bindPopup(`
          <div style="color: #1f2937; font-family: sans-serif; line-height: 1.4; min-width: 220px;">
            <div style="background: ${color}; color: white; padding: 8px; margin: -8px -8px 8px -8px; border-radius: 4px 4px 0 0;">
              <b style="font-size: 14px;">${competitor.name}</b>
              <div style="font-size: 11px; opacity: 0.9;">${isTopCompetitor ? 'Top Competitor' : 'Competitor'}</div>
            </div>
            <div style="font-size: 12px;">
              <div style="margin-bottom: 8px;"><b>💰 ${careRate}</b></div>
              <div style="margin-bottom: 8px;"><b>💵 Room Rates:</b> Use competitor form to add room rates</div>
              <div style="margin-bottom: 8px;"><b>🏢 Status:</b> Basic competitor data loaded</div>
              <div style="margin-top: 10px;">
                <a href="${googleMapsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px; margin-right: 10px;">📍 View on Google</a>
                <a href="${directionsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px;">🚗 Directions</a>
              </div>
            </div>
          </div>
        `);
      });
      
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
            Competitor Map - Louisville, KY
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Interactive competitor location and pricing data
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