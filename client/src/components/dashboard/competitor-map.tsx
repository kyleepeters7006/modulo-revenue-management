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
          console.log('Leaflet loaded, initializing map...');
          // Longer delay to ensure everything is loaded
          setTimeout(() => initializeMap(), 500);
        };
        script.onerror = (error) => {
          console.error('Error loading Leaflet script:', error);
        };
        document.head.appendChild(script);
      } else {
        console.log('Leaflet already loaded, initializing map...');
        initializeMap();
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

    // Small delay to ensure DOM is ready
    setTimeout(() => loadLeaflet(), 100);

    return () => {
      if (mapInstanceRef.current) {
        console.log('Cleaning up map...');
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const competitorData = competitors as any;
    console.log('Processing competitor data:', { 
      hasMap: !!mapInstanceRef.current, 
      competitorData: competitorData?.items?.length || 0 
    });
    
    if (mapInstanceRef.current && competitorData?.items) {
      // Clear existing markers
      markersRef.current.forEach(marker => {
        mapInstanceRef.current.removeLayer(marker);
      });
      markersRef.current = [];

      // Add new markers
      competitorData.items.forEach((competitor: any) => {
        console.log('Adding marker for:', competitor.name, 'at', [competitor.lat, competitor.lng]);
        const marker = window.L.marker([competitor.lat, competitor.lng]).addTo(mapInstanceRef.current);
        
        const rates = competitor.rates 
          ? Object.entries(competitor.rates)
              .map(([roomType, rate]) => `${roomType}: $${rate}`)
              .join('<br>')
          : 'No room rates available';
        
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
      
      console.log(`Added ${markersRef.current.length} markers to map`);
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
