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
  selectedServiceLines?: string[];
}

interface PortfolioLocation {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  division: string | null;
}

interface PortfolioLocationsResponse {
  locations: PortfolioLocation[];
  regions: string[];
  divisions: string[];
}

export function CompetitorMap({ 
  selectedRegions = [], 
  selectedDivisions = [], 
  selectedLocations = [],
  selectedServiceLines = []
}: CompetitorMapProps = {}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  
  // Build query params for filtering
  const queryParams = new URLSearchParams();
  if (selectedRegions.length > 0) queryParams.append('regions', selectedRegions.join(','));
  if (selectedDivisions.length > 0) queryParams.append('divisions', selectedDivisions.join(','));
  if (selectedLocations.length > 0) queryParams.append('locations', selectedLocations.join(','));
  if (selectedServiceLines.length > 0) queryParams.append('serviceLines', selectedServiceLines.join(','));
  const queryString = queryParams.toString();
  
  const { data: competitors, isLoading } = useQuery({
    queryKey: ["/api/competitors", selectedRegions, selectedDivisions, selectedLocations, selectedServiceLines],
    queryFn: async () => {
      const response = await fetch(`/api/competitors${queryString ? '?' + queryString : ''}`);
      if (!response.ok) throw new Error('Failed to fetch competitors');
      return response.json();
    }
  });

  const isAllLocations = selectedLocations.length === 0;

  const { data: portfolioLocationsData } = useQuery<PortfolioLocationsResponse>({
    queryKey: ["/api/locations"],
    enabled: isAllLocations,
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
        // Create new map with dynamic center based on data
        const mapCenter = getMapCenter();
        mapInstanceRef.current = window.L.map(mapRef.current, {
          center: mapCenter,
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
    
    const getMapCenter = () => {
      // Default fallback coordinates (Louisville area)
      const defaultCenter = [38.2527, -85.7585];
      
      try {
        // First priority: use the selected location's real geocoded coordinates from the locations table
        const competitorData = competitors as any;
        const cl = competitorData?.currentLocation;
        if (Number.isFinite(cl?.lat) && Number.isFinite(cl?.lng)) {
          return [cl.lat, cl.lng];
        }
        
        // Fallback: calculate center from all visible competitors
        if (competitorData?.items?.length > 0) {
          const validCompetitors = competitorData.items.filter((comp: any) => 
            Number.isFinite(comp.lat) && Number.isFinite(comp.lng)
          );
          
          if (validCompetitors.length > 0) {
            const avgLat = validCompetitors.reduce((sum: number, comp: any) => sum + comp.lat, 0) / validCompetitors.length;
            const avgLng = validCompetitors.reduce((sum: number, comp: any) => sum + comp.lng, 0) / validCompetitors.length;
            return [avgLat, avgLng];
          }
        }
      } catch (error) {
        console.log('Error calculating map center:', error);
      }
      
      return defaultCenter;
    };

    const addMarkers = () => {
      if (!mapInstanceRef.current || !window.L || !competitors || !mounted) return;
      
      const competitorData = competitors as any;
      if (!competitorData?.items) return;
      
      // Use the real location coordinates returned by the API from the locations table
      // Validate that the API-provided currentLocation has finite coordinates before accepting it
      const apiLocation = competitorData.currentLocation;
      let currentLocation = (apiLocation && Number.isFinite(apiLocation.lat) && Number.isFinite(apiLocation.lng))
        ? apiLocation
        : null;
      
      // Set up portfolio property data for use in comparisons
      // This will be used by competitor popups even if we don't show a portfolio marker
      const currentProperty = (currentLocation && Number.isFinite(currentLocation.lat) && Number.isFinite(currentLocation.lng)) ? {
        name: currentLocation.name,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        avgRate: 0,
        avgCareRate: 0,
        address: currentLocation.address
      } : {
        // Default values when no valid location
        name: "Portfolio Average",
        lat: 38.2527,
        lng: -85.7585,
        avgRate: 0,
        avgCareRate: 0,
        address: ""
      };
      
      // Only show portfolio location marker if we have valid coordinates from actual data
      if (currentLocation && currentLocation.lat && currentLocation.lng) {
        
        // Current property icon using original image
        const currentIcon = window.L.icon({
          iconUrl: "/attached_assets/image_1756856984756.png",
          iconSize: [40, 40],
          iconAnchor: [20, 40],
          popupAnchor: [0, -40]
        });
        
        const currentMarker = window.L.marker([currentProperty.lat, currentProperty.lng], {
          icon: currentIcon
        }).addTo(mapInstanceRef.current);

        currentMarker.bindPopup(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 280px; max-width: 340px; padding: 0; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
          <!-- Header with gradient background -->
          <div style="background: linear-gradient(135deg, #0071e3 0%, #005bb5 100%); color: white; padding: 20px; position: relative;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
              <h3 style="margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.5px; line-height: 1.3;">${currentProperty.name}</h3>
              <span style="background: rgba(255,255,255,0.2); color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; white-space: nowrap; flex-shrink: 0;">YOUR PROPERTY</span>
            </div>
            ${currentProperty.address ? `<p style="margin: 0; font-size: 12px; opacity: 0.85; font-weight: 300;">${currentProperty.address}</p>` : ''}
          </div>
        </div>
      `);
      } // End of if block for currentLocation check
      
      // Haversine distance helper — miles between two lat/lng points
      const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 3959;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      // Competitor markers
      competitorData.items.forEach((competitor: any) => {
        if (!Number.isFinite(competitor.lat) || !Number.isFinite(competitor.lng) || !mounted) return;

        // Skip pins that are geographically implausible — geocoded to the wrong
        // city (e.g. "Albany" resolved to Albany, OR instead of the facility's
        // Albany). If we have a known facility location, require the pin to be
        // within 30 miles. This matches the ~20-minute drive requirement.
        if (currentLocation && Number.isFinite(currentLocation.lat) && Number.isFinite(currentLocation.lng)) {
          const geoDistMiles = haversineDistance(
            currentLocation.lat, currentLocation.lng,
            competitor.lat, competitor.lng
          );
          if (geoDistMiles > 30) return; // skip — geocoded to wrong city
        }
        
        // Style based on distance (closer = larger/more prominent)
        const getDistanceStyle = (distanceMiles: number | undefined) => {
          if (!distanceMiles) {
            return { 
              color: '#6b7280', 
              size: '24px'
            };
          }
          
          // Color and size based on proximity
          if (distanceMiles <= 1) {
            return { 
              color: '#ef4444', // Red for very close competitors
              size: '28px'
            };
          } else if (distanceMiles <= 3) {
            return { 
              color: '#f97316', // Orange for nearby
              size: '26px'
            };
          } else if (distanceMiles <= 5) {
            return { 
              color: '#3b82f6', // Blue for moderate distance
              size: '24px'
            };
          } else {
            return { 
              color: '#6b7280', // Gray for far away
              size: '22px'
            };
          }
        };
        
        const style = getDistanceStyle(competitor.distanceMiles);
        
        const competitorMarkerIcon = window.L.icon({
          iconUrl: "/attached_assets/image_1756857075316.png",
          iconSize: [parseInt(style.size), parseInt(style.size)],
          iconAnchor: [parseInt(style.size) / 2, parseInt(style.size)],
          popupAnchor: [0, -parseInt(style.size)]
        });
        
        const marker = window.L.marker([competitor.lat, competitor.lng], {
          icon: competitorMarkerIcon
        }).addTo(mapInstanceRef.current);
        
        // Determine if this is HC (Health Center) which uses daily rates
        // Check both serviceLine and serviceLines array (competitors can have multiple service lines)
        const isHC = competitor.serviceLine === 'HC' || 
                     competitor.serviceLine === 'HC/MC' ||
                     competitor.competitorType === 'HC' ||
                     (competitor.serviceLines && competitor.serviceLines.some((sl: string) => 
                       sl === 'HC' || sl === 'HC/MC'));
        
        // Calculate comparison to portfolio
        const avgPortfolioRate = currentProperty.avgRate || 3500;
        let avgCompetitorRate = competitor.streetRate || competitor.avgRate || 3500;
        const avgCareRate = competitor.avgCareRate || 500;
        
        // For HC, convert monthly rate to daily for display
        let displayRate = avgCompetitorRate;
        let displayCareRate = avgCareRate;
        let displayTotalRate = avgCompetitorRate + avgCareRate;
        let rateLabel = isHC ? 'Daily' : 'Monthly';
        
        if (isHC) {
          // Convert monthly to daily for HC display
          displayRate = Math.round(avgCompetitorRate / 30.44);
          displayCareRate = Math.round(avgCareRate / 30.44);
          displayTotalRate = displayRate + displayCareRate;
        }
        
        // Keep comparison in monthly terms for consistency
        const totalRate = avgCompetitorRate + avgCareRate;
        const totalPortfolioRate = avgPortfolioRate + (currentProperty.avgCareRate || 500);
        const comparison = totalRate - totalPortfolioRate;
        const comparisonText = comparison > 0 ? `+$${comparison.toLocaleString()}` : comparison < 0 ? `-$${Math.abs(comparison).toLocaleString()}` : 'Same';
        const comparisonColor = comparison > 0 ? '#10b981' : comparison < 0 ? '#ef4444' : '#6b7280';

        // Format room rates more elegantly
        let primaryRate = displayRate;
        const popupServiceLine = competitor.serviceLine || (competitor.serviceLines && competitor.serviceLines[0]) || null;
        let roomTypeLabel = isHC ? `HC Rate${popupServiceLine ? ` (${popupServiceLine})` : ''}` : `Avg Rate${popupServiceLine ? ` (${popupServiceLine})` : ''}`;
        if (!isHC && competitor.rates && typeof competitor.rates === 'object') {
          if (competitor.rates.Studio || competitor.rates.studio) {
            primaryRate = competitor.rates.Studio || competitor.rates.studio;
            roomTypeLabel = `Studio${popupServiceLine ? ` (${popupServiceLine})` : ''}`;
          } else if (competitor.rates['One Bedroom'] || competitor.rates.oneBedroom) {
            primaryRate = competitor.rates['One Bedroom'] || competitor.rates.oneBedroom;
            roomTypeLabel = `1BR${popupServiceLine ? ` (${popupServiceLine})` : ''}`;
          }
        }
        // For roomRates array, derive label from first entry if available
        if (competitor.roomRates && competitor.roomRates.length > 0) {
          const firstRR = competitor.roomRates[0];
          const rrSL = firstRR.competitorType || popupServiceLine;
          if (firstRR.streetRate != null) {
            primaryRate = firstRR.streetRate;
            roomTypeLabel = `${firstRR.roomType}${rrSL ? ` (${rrSL})` : ''}`;
          }
        }

        const searchTerm = competitor.address || `${competitor.name} Louisville KY`;
        const encodedAddress = encodeURIComponent(searchTerm);
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        const directionsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(currentProperty.address)}/${encodedAddress}`;

        marker.bindPopup(`
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 320px; max-width: 360px; padding: 0; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
            <!-- Header with gradient background -->
            <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 20px; position: relative;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.5px;">${competitor.name}</h3>
                ${competitor.distanceMiles ? `
                <span style="background: #3b82f620; color: #2563eb; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">
                  ${competitor.distanceMiles.toFixed(1)} mi
                </span>
                ` : ''}
              </div>
              <p style="margin: 0; font-size: 13px; opacity: 0.85; font-weight: 300;">Competitor Location</p>
            </div>
            
            <!-- Main content with key metrics -->
            <div style="padding: 20px;">
              <!-- Service Line Badge + Weight Badge -->
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
                ${isHC ? `
                <div style="display: inline-block; background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  HC - Daily Rates
                </div>
                ` : `
                <div style="display: inline-block; background: #dbeafe; border: 1px solid #60a5fa; color: #1e3a8a; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${competitor.serviceLine || 'AL'} - Monthly Rates
                </div>
                `}
                ${(() => {
                  const wbsl: Record<string, number> = competitor.weightsByServiceLine || {};
                  const perSLEntries = Object.entries(wbsl);
                  if (perSLEntries.length > 0) {
                    return perSLEntries.map(([sl, w]) => `
                <div style="display: inline-block; background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;">
                  ⚖ ${sl}: ${Math.round((w as number) * 100)}%
                </div>`).join('');
                  }
                  if (competitor.weight != null && competitor.weight > 0) {
                    if (competitor.serviceLines && competitor.serviceLines.length > 0) {
                      return competitor.serviceLines.map((sl: string) => `
                <div style="display: inline-block; background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;">
                  ⚖ ${sl}: ${Math.round(competitor.weight * 100)}%
                </div>`).join('');
                    }
                    return `
                <div style="display: inline-block; background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px;">
                  ⚖ ${Math.round(competitor.weight * 100)}% weight
                </div>`;
                  }
                  return '';
                })()}
              </div>
              
              <!-- Rate Section -->
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">
                <!-- Room Rate -->
                <div style="text-align: center;">
                  <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">RATE</p>
                  <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 600; color: #1e293b;">$${Number(primaryRate).toLocaleString()}</p>
                  <p style="margin: 2px 0 0 0; font-size: 10px; color: #64748b;">${roomTypeLabel}</p>
                </div>
                
                <!-- Care Rate -->
                <div style="text-align: center; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
                  <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">CARE</p>
                  <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 600; color: #1e293b;">$${displayCareRate.toLocaleString()}</p>
                  <p style="margin: 2px 0 0 0; font-size: 10px; color: #64748b;">${rateLabel}</p>
                </div>
                
                <!-- Total -->
                <div style="text-align: center;">
                  <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">TOTAL</p>
                  <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 600; color: #1e293b;">$${displayTotalRate.toLocaleString()}</p>
                  <p style="margin: 2px 0 0 0; font-size: 10px; color: #64748b;">${rateLabel}</p>
                </div>
              </div>
              
              <!-- Comparison Section -->
              <div style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 12px; color: #64748b; font-weight: 500;">vs. Portfolio Average</span>
                  <span style="font-size: 16px; font-weight: 600; color: ${comparisonColor};">${comparisonText}</span>
                </div>
              </div>
              
              ${competitor.attributes?.nearestTrilogyLocation ? `
              <!-- Nearest Trilogy Location -->
              <div style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border-left: 3px solid #0ea5e9; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  <span style="font-size: 11px; color: #0369a1; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Nearest Trilogy Location</span>
                </div>
                <p style="margin: 0; font-size: 14px; color: #0c4a6e; font-weight: 600;">${competitor.attributes.nearestTrilogyLocation}</p>
                <p style="margin: 4px 0 0 0; font-size: 12px; color: #0369a1;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline; vertical-align: text-top; margin-right: 4px;">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  ${competitor.attributes.distanceToNearest?.toFixed(1)} miles away
                </p>
              </div>
              ` : ''}
              
              <!-- Action Links -->
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                <a href="${googleMapsUrl}" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  Map
                </a>
                <a href="${directionsUrl}" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l14 0"/><path d="M13 5l7 7-7 7"/></svg>
                  Directions
                </a>
                <a href="/competitors?edit=${competitor.id}" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #eff6ff; color: #1d4ed8; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #bfdbfe;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </a>
              </div>
            </div>
          </div>
        `);
      });
      
      const validCompItems = competitorData.items.filter((comp: any) =>
        Number.isFinite(comp.lat) && Number.isFinite(comp.lng)
      );

      // In All Locations mode, render blue pins for each portfolio location with coordinates
      const portfolioLocations: PortfolioLocation[] = portfolioLocationsData?.locations || [];
      const validPortfolioLocations = isAllLocations
        ? portfolioLocations.filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
        : [];

      validPortfolioLocations.forEach((loc) => {
        if (!mounted) return;
        const bluePinIcon = window.L.divIcon({
          className: '',
          html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
            <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22s14-12.667 14-22C28 6.268 21.732 0 14 0z" fill="#1e3a8a" stroke="#fff" stroke-width="1.5"/>
            <circle cx="14" cy="14" r="5.5" fill="white"/>
          </svg>`,
          iconSize: [28, 36],
          iconAnchor: [14, 36],
          popupAnchor: [0, -36]
        });

        const addressParts = [loc.address, loc.city, loc.state].filter(Boolean);
        const fullAddress = addressParts.join(', ');

        const portfolioMarker = window.L.marker([loc.lat, loc.lng], { icon: bluePinIcon })
          .addTo(mapInstanceRef.current);

        portfolioMarker.bindPopup(`
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 220px; max-width: 280px; padding: 0; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.10);">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: white; padding: 16px;">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.3px; line-height: 1.3;">${loc.name}</h3>
                <span style="background: rgba(255,255,255,0.2); color: white; padding: 3px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; letter-spacing: 0.5px; white-space: nowrap; flex-shrink: 0;">PORTFOLIO</span>
              </div>
              ${fullAddress ? `<p style="margin: 0; font-size: 12px; opacity: 0.85; font-weight: 300;">${fullAddress}</p>` : ''}
            </div>
          </div>
        `);
      });

      console.log(`Added ${validCompItems.length + (currentLocation ? 1 : 0)} markers to map` + (isAllLocations ? ` + ${validPortfolioLocations.length} portfolio pins` : ''));

      // Collect all rendered points for bounds fitting
      const portfolioPoints = validPortfolioLocations.map((loc: any) => [loc.lat, loc.lng]);

      // Set map view: fit bounds when competitors or portfolio pins exist
      if ((validCompItems.length > 0 || portfolioPoints.length > 0) && mapInstanceRef.current) {
        const startPoint = !isAllLocations && Number.isFinite(currentProperty.lat) && Number.isFinite(currentProperty.lng)
          ? [[currentProperty.lat, currentProperty.lng]]
          : [];
        const compPoints = validCompItems.map((comp: any) => [comp.lat, comp.lng]);
        const allPoints = [...startPoint, ...compPoints, ...portfolioPoints];
        if (allPoints.length > 0) {
          const bounds = window.L.latLngBounds(allPoints);
          mapInstanceRef.current.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: isAllLocations ? 8 : 13
          });
        }
      } else if (Number.isFinite(currentProperty.lat) && Number.isFinite(currentProperty.lng)) {
        // No competitors: center directly on the selected location
        mapInstanceRef.current.setView([currentProperty.lat, currentProperty.lng], 11);
      }
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
  }, [competitors, portfolioLocationsData]);

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
            {(() => {
              const items = (competitors as any)?.items;
              const cl = (competitors as any)?.currentLocation;
              if (!items) return 0;
              // Count unique visible pins — competitors that share the same lat/lng
              // render as one stacked marker, so count by unique position.
              const validItems = items.filter((c: any) => {
                if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false;
                if (cl && Number.isFinite(cl.lat) && Number.isFinite(cl.lng)) {
                  const dLat = (c.lat - cl.lat) * Math.PI / 180;
                  const dLng = (c.lng - cl.lng) * Math.PI / 180;
                  const a = Math.sin(dLat / 2) ** 2 +
                    Math.cos(cl.lat * Math.PI / 180) * Math.cos(c.lat * Math.PI / 180) *
                    Math.sin(dLng / 2) ** 2;
                  return 3959 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 30;
                }
                return true;
              });
              const uniquePins = new Set(validItems.map((c: any) => `${c.lat},${c.lng}`)).size;
              return uniquePins;
            })()} competitors found
            {selectedLocations.length > 1 && ' • Top 3 shown per location'}
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