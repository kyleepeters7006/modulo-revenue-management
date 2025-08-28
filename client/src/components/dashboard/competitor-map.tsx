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
          // Small delay to ensure everything is loaded
          setTimeout(() => initializeMap(), 100);
        };
        document.head.appendChild(script);
      } else {
        initializeMap();
      }
    };

    const initializeMap = () => {
      if (mapRef.current && !mapInstanceRef.current && window.L) {
        try {
          // Initialize map centered on Louisville, KY
          mapInstanceRef.current = window.L.map(mapRef.current).setView([38.2527, -85.7585], 11);
          
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(mapInstanceRef.current);
        } catch (error) {
          console.error('Error initializing map:', error);
        }
      }
    };

    loadLeaflet();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const competitorData = competitors as any;
    if (mapInstanceRef.current && competitorData?.items) {
      // Clear existing markers
      markersRef.current.forEach(marker => {
        mapInstanceRef.current.removeLayer(marker);
      });
      markersRef.current = [];

      // Add new markers
      competitorData.items.forEach((competitor: any) => {
        const marker = window.L.marker([competitor.lat, competitor.lng]).addTo(mapInstanceRef.current);
        
        const rates = competitor.rates 
          ? Object.entries(competitor.rates)
              .map(([roomType, rate]) => `${roomType}: $${rate}`)
              .join('<br>')
          : 'No rates available';
        
        const careRate = competitor.avgCareRate ? `<br>Avg Care: $${competitor.avgCareRate}` : '';
        
        marker.bindPopup(`
          <div style="color: #1f2937;">
            <b>${competitor.name}</b><br>
            ${rates}
            ${careRate}
          </div>
        `);
        
        markersRef.current.push(marker);
      });
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
        className="h-96 bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-lg"
        data-testid="map-container"
      />
    </div>
  );
}
