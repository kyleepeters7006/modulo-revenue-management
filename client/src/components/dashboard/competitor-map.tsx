import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    L: any;
  }
}

export default function CompetitorMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const { data: competitors, isLoading } = useQuery({
    queryKey: ["/api/competitors"],
  });

  useEffect(() => {
    // Load Leaflet CSS and JS
    const loadLeaflet = async () => {
      console.log('Loading Leaflet...', { hasWindow: !!window.L, mapRef: !!mapRef.current });
      
      if (!window.L) {
        // Add Leaflet CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);

        // Add Leaflet JS
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
          console.log('Leaflet loaded, waiting for DOM...');
          // Wait for DOM to be ready and map ref to be available
          const checkAndInit = () => {
            if (mapRef.current) {
              console.log('DOM ready, initializing map...');
              initializeMap();
            } else {
              console.log('Map ref not ready, retrying...');
              setTimeout(checkAndInit, 100);
            }
          };
          setTimeout(checkAndInit, 100);
        };
        script.onerror = (error) => {
          console.error('Error loading Leaflet script:', error);
        };
        document.head.appendChild(script);
      } else {
        console.log('Leaflet already loaded, checking DOM...');
        if (mapRef.current) {
          initializeMap();
        } else {
          setTimeout(() => {
            if (mapRef.current) initializeMap();
          }, 100);
        }
      }
    };

    const initializeMap = () => {
      console.log('Attempting to initialize map...', { 
        mapRef: !!mapRef.current, 
        mapInstance: !!mapInstanceRef.current, 
        leaflet: !!window.L 
      });
      
      if (mapRef.current && !mapInstanceRef.current && window.L) {
        try {
          console.log('Creating map instance...');
          // Clear any existing content
          mapRef.current.innerHTML = '';
          
          // Initialize map centered on Louisville, KY
          mapInstanceRef.current = window.L.map(mapRef.current, {
            center: [38.2527, -85.7585],
            zoom: 11,
            scrollWheelZoom: true
          });
          
          console.log('Adding tile layer...');
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
          }).addTo(mapInstanceRef.current);
          
          console.log('Map initialized successfully!');
          
          // Force a resize after a short delay
          setTimeout(() => {
            if (mapInstanceRef.current) {
              mapInstanceRef.current.invalidateSize();
            }
          }, 100);
          
        } catch (error) {
          console.error('Error initializing map:', error);
        }
      } else {
        console.log('Map initialization skipped:', {
          noMapRef: !mapRef.current,
          alreadyExists: !!mapInstanceRef.current,
          noLeaflet: !window.L
        });
      }
    };

    // Start loading immediately
    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        console.log('Cleaning up map...');
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          console.log('Map cleanup error:', e);
        }
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const competitorData = competitors as any;
    console.log('Processing competitor data:', { 
      hasMap: !!mapInstanceRef.current, 
      competitorData: competitorData?.items?.length || 0,
      leaflet: !!window.L,
      competitors: competitors
    });
    
    if (mapInstanceRef.current && window.L && competitorData?.items) {
      // Clear existing markers
      markersRef.current.forEach(marker => {
        mapInstanceRef.current.removeLayer(marker);
      });
      markersRef.current = [];

      // Current property data (Sunset Manor)
      const currentProperty = {
        name: "Sunset Manor Senior Living",
        lat: 38.2527,
        lng: -85.7585,
        rates: {
          "Studio": 3175,
          "One Bedroom": 4200,
          "Two Bedroom": 5100,
          "Memory Care": 4800
        },
        avgCareRate: 775,
        address: "1234 Main St, Louisville, KY 40207"
      };

      // Create custom icons
      const currentPropertyIcon = window.L.divIcon({
        html: `<div style="
          width: 20px; 
          height: 20px; 
          background-color: #2563eb; 
          border: 3px solid white; 
          border-radius: 50%; 
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        "></div>`,
        className: 'custom-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      const topCompetitorIcon = window.L.divIcon({
        html: `<div style="
          width: 12px; 
          height: 12px; 
          background-color: #14b8a6; 
          border: 2px solid white; 
          border-radius: 50%; 
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        "></div>`,
        className: 'custom-marker',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const competitorIcon = window.L.divIcon({
        html: `<div style="
          width: 10px; 
          height: 10px; 
          background-color: #6b7280; 
          border: 2px solid white; 
          border-radius: 50%; 
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        "></div>`,
        className: 'custom-marker',
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      });

      // Add current property marker
      const currentMarker = window.L.marker([currentProperty.lat, currentProperty.lng], {
        icon: currentPropertyIcon
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
            <div style="margin-bottom: 8px;">
              <b>Room Rates:</b><br>
              ${currentRates}
            </div>
            <div style="margin-bottom: 8px;">
              <b>Avg Care:</b> $${currentProperty.avgCareRate}
            </div>
            <div style="font-size: 11px; color: #6b7280;">
              ${currentProperty.address}
            </div>
          </div>
        </div>
      `);
      
      markersRef.current.push(currentMarker);

      // Add competitor markers
      if (competitorData?.items) {
        competitorData.items.forEach((competitor: any) => {
          console.log('Adding marker for:', competitor.name, 'at', [competitor.lat, competitor.lng]);
          
          // Validate coordinates before adding marker
          if (!competitor.lat || !competitor.lng) {
            console.log('Skipping competitor with invalid coordinates:', competitor.name);
            return;
          }
          
          const isTopCompetitor = competitor.avgCareRate && competitor.avgCareRate > 900;
          const icon = isTopCompetitor ? topCompetitorIcon : competitorIcon;
          
          const marker = window.L.marker([competitor.lat, competitor.lng], {
            icon: icon
          }).addTo(mapInstanceRef.current);
          
          const careRateDiff = competitor.avgCareRate ? (competitor.avgCareRate - currentProperty.avgCareRate) : 0;
          const careRate = competitor.avgCareRate 
            ? `Avg Care: $${competitor.avgCareRate} (${careRateDiff > 0 ? '+' : ''}$${careRateDiff})`
            : 'Avg Care: Not available';

          // Generate Google Maps search link
          const searchTerm = competitor.address || `${competitor.name} Louisville KY`;
          const encodedAddress = encodeURIComponent(searchTerm);
          const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
          
          // Generate directions link
          const directionsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(currentProperty.address)}/${encodedAddress}`;

          marker.bindPopup(`
            <div style="color: #1f2937; font-family: sans-serif; line-height: 1.4; min-width: 220px;">
              <div style="background: ${isTopCompetitor ? '#14b8a6' : '#6b7280'}; color: white; padding: 8px; margin: -8px -8px 8px -8px; border-radius: 4px 4px 0 0;">
                <b style="font-size: 14px;">${competitor.name}</b>
                <div style="font-size: 11px; opacity: 0.9;">${isTopCompetitor ? 'Top Competitor' : 'Competitor'}</div>
              </div>
              <div style="font-size: 12px;">
                <div style="margin-bottom: 8px;">
                  <b>💰 ${careRate}</b>
                </div>
                <div style="margin-bottom: 8px;">
                  <b>💵 Room Rates:</b> Use competitor form to add room rates
                </div>
                <div style="margin-bottom: 8px;">
                  <b>🏢 Status:</b> Basic competitor data loaded
                </div>
                <div style="margin-top: 10px;">
                  <a href="${googleMapsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px; margin-right: 10px;">📍 View on Google</a>
                  <a href="${directionsUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-size: 11px;">🚗 Directions</a>
                </div>
              </div>
            </div>
          `);
          
          markersRef.current.push(marker);
        });
      }
      
      console.log(`Added ${markersRef.current.length} total markers to map`);
    }
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
        {!mapInstanceRef.current && (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--dashboard-muted)]">
            <div className="text-center">
              <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Loading interactive map...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
