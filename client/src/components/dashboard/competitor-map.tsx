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
        
        // Add enhanced tile layer with better styling
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap contributors © CARTO',
          maxZoom: 18,
          subdomains: 'abcd'
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
      
      // Enhanced current property icon
      const currentIcon = window.L.divIcon({
        html: `<div style="width: 32px; height: 32px; background: linear-gradient(135deg, #0071e3, #005bb5); border: 4px solid white; border-radius: 50%; box-shadow: 0 6px 20px rgba(0,113,227,0.4); position: relative;">
                 <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 14px; font-weight: bold;">📍</div>
               </div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      
      const currentMarker = window.L.marker([currentProperty.lat, currentProperty.lng], {
        icon: currentIcon
      }).addTo(mapInstanceRef.current);
      
      const currentRates = Object.entries(currentProperty.rates)
        .map(([roomType, rate]) => `${roomType}: $${rate.toLocaleString()}`)
        .join('<br>');
      
      currentMarker.bindPopup(`
        <div style="color: #1f2937; font-family: system-ui, -apple-system, sans-serif; line-height: 1.4; min-width: 280px; max-width: 320px;">
          <div style="background: linear-gradient(135deg, #0071e3, #005bb5); color: white; padding: 12px; margin: -8px -8px 12px -8px; border-radius: 6px 6px 0 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <b style="font-size: 15px; display: flex; align-items: center; gap: 6px;">
              📍 ${currentProperty.name}
            </b>
            <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">Your Property</div>
          </div>
          <div style="font-size: 12px; padding: 0 4px;">
            <div style="margin-bottom: 10px; padding: 8px; background: #f0f8ff; border-radius: 4px; border: 1px solid #e0f2fe;">
              <b style="color: #0071e3; margin-bottom: 6px; display: block;">🏠 Room Rates:</b>
              <div style="font-size: 11px; line-height: 1.6; color: #374151;">${currentRates}</div>
            </div>
            <div style="margin-bottom: 10px; padding: 8px; background: #f8fafc; border-radius: 4px;">
              <b style="color: #059669;">💰 Avg Care: $${currentProperty.avgCareRate.toLocaleString()}</b>
            </div>
            <div style="font-size: 11px; color: #6b7280; text-align: center; padding: 4px; border-top: 1px solid #e5e7eb;">
              ${currentProperty.address}
            </div>
          </div>
        </div>
      `);
      
      // Competitor markers
      competitorData.items.forEach((competitor: any) => {
        if (!competitor.lat || !competitor.lng || !mounted) return;
        
        // Enhanced color and styling based on A/B/C rating
        const getRatingStyle = (rating: string) => {
          switch (rating?.toUpperCase()) {
            case 'A': return { 
              color: '#22c55e', 
              size: '28px', 
              gradient: 'linear-gradient(135deg, #22c55e, #16a34a)',
              emoji: '⭐'
            };
            case 'B': return { 
              color: '#f59e0b', 
              size: '26px', 
              gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
              emoji: '👍'
            };
            case 'C': return { 
              color: '#ef4444', 
              size: '24px', 
              gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
              emoji: '⚠️'
            };
            default: return { 
              color: '#6b7280', 
              size: '24px', 
              gradient: 'linear-gradient(135deg, #6b7280, #4b5563)',
              emoji: '📍'
            };
          }
        };
        
        const style = getRatingStyle(competitor.rating);
        
        const competitorIcon = window.L.divIcon({
          html: `<div style="width: ${style.size}; height: ${style.size}; background: ${style.gradient}; border: 3px solid white; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); position: relative; display: flex; align-items: center; justify-content: center;">
                   <span style="font-size: 12px;">${style.emoji}</span>
                 </div>`,
          iconSize: [parseInt(style.size) + 6, parseInt(style.size) + 6],
          iconAnchor: [(parseInt(style.size) + 6) / 2, (parseInt(style.size) + 6) / 2]
        });
        
        const marker = window.L.marker([competitor.lat, competitor.lng], {
          icon: competitorIcon
        }).addTo(mapInstanceRef.current);
        
        const careRateDiff = competitor.avgCareRate ? (competitor.avgCareRate - currentProperty.avgCareRate) : 0;
        const careRate = competitor.avgCareRate 
          ? `Avg Care: $${competitor.avgCareRate.toLocaleString()} (${careRateDiff > 0 ? '+' : ''}$${careRateDiff.toLocaleString()})`
          : 'Avg Care: Not available';

        // Format room rates from the rates object
        let roomRatesHtml = 'No room rates provided';
        if (competitor.rates && typeof competitor.rates === 'object') {
          const rates = [];
          // Check for both camelCase and proper case keys
          if (competitor.rates.Studio || competitor.rates.studio) {
            const rate = competitor.rates.Studio || competitor.rates.studio;
            rates.push(`Studio: $${Number(rate).toLocaleString()}`);
          }
          if (competitor.rates['One Bedroom'] || competitor.rates.oneBedroom) {
            const rate = competitor.rates['One Bedroom'] || competitor.rates.oneBedroom;
            rates.push(`One Bedroom: $${Number(rate).toLocaleString()}`);
          }
          if (competitor.rates['Two Bedroom'] || competitor.rates.twoBedroom) {
            const rate = competitor.rates['Two Bedroom'] || competitor.rates.twoBedroom;
            rates.push(`Two Bedroom: $${Number(rate).toLocaleString()}`);
          }
          if (competitor.rates['Memory Care'] || competitor.rates.memoryCare) {
            const rate = competitor.rates['Memory Care'] || competitor.rates.memoryCare;
            rates.push(`Memory Care: $${Number(rate).toLocaleString()}`);
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
          <div style="color: #1f2937; font-family: system-ui, -apple-system, sans-serif; line-height: 1.4; min-width: 280px; max-width: 320px;">
            <div style="background: ${style.gradient}; color: white; padding: 12px; margin: -8px -8px 12px -8px; border-radius: 6px 6px 0 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <b style="font-size: 15px; display: flex; align-items: center; gap: 6px;">
                ${style.emoji} ${competitor.name}
              </b>
              <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">Competitor • ${rating} Rating</div>
            </div>
            <div style="font-size: 12px; padding: 0 4px;">
              <div style="margin-bottom: 10px; padding: 8px; background: #f8fafc; border-radius: 4px;">
                <b style="color: #059669;">💰 ${careRate}</b>
              </div>
              <div style="margin-bottom: 10px;">
                <b style="color: #374151; margin-bottom: 6px; display: block;">🏠 Room Rates:</b>
                <div style="font-size: 11px; line-height: 1.6; color: #6b7280;">${roomRatesHtml}</div>
              </div>
              <div style="display: flex; gap: 8px; margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 8px;">
                <a href="${googleMapsUrl}" target="_blank" style="color: #0071e3; text-decoration: none; font-size: 11px; padding: 4px 8px; background: #f0f8ff; border-radius: 4px; flex: 1; text-align: center;">📍 View</a>
                <a href="${directionsUrl}" target="_blank" style="color: #0071e3; text-decoration: none; font-size: 11px; padding: 4px 8px; background: #f0f8ff; border-radius: 4px; flex: 1; text-align: center;">🚗 Directions</a>
              </div>
            </div>
          </div>
        `);
      });
      
      // Adjust map to fit all markers with better padding
      if (competitorData.items.length > 0 && mapInstanceRef.current) {
        const bounds = window.L.latLngBounds(
          [[currentProperty.lat, currentProperty.lng]]
        );
        competitorData.items.forEach((comp: any) => {
          if (comp.lat && comp.lng) {
            bounds.extend([comp.lat, comp.lng]);
          }
        });
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: [60, 60],
          maxZoom: 13 // Prevent excessive zoom-in
        });
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