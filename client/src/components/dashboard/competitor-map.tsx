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
      
      if (!competitors?.items?.length) return defaultCenter;
      
      try {
        // If we have a single location selected, center on that location's competitors
        if (selectedLocations.length === 1) {
          const locationCompetitors = competitors.items.filter((comp: any) => 
            comp.location === selectedLocations[0]
          );
          
          if (locationCompetitors.length > 0) {
            const avgLat = locationCompetitors.reduce((sum: number, comp: any) => sum + (comp.lat || 0), 0) / locationCompetitors.length;
            const avgLng = locationCompetitors.reduce((sum: number, comp: any) => sum + (comp.lng || 0), 0) / locationCompetitors.length;
            
            // Validate coordinates
            if (avgLat && avgLng && !isNaN(avgLat) && !isNaN(avgLng)) {
              return [avgLat, avgLng];
            }
          }
        }
        
        // Calculate center from all visible competitors
        if (competitors.items.length > 0) {
          const validCompetitors = competitors.items.filter((comp: any) => 
            comp.lat && comp.lng && !isNaN(comp.lat) && !isNaN(comp.lng)
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
      
      // Get current property location based on selected location filter
      let currentLocation;
      
      if (selectedLocations.length === 1) {
        // Single location selected - find its coordinates from competitors data
        const locationCompetitors = competitorData.items.filter((comp: any) => 
          comp.location === selectedLocations[0]
        );
        
        if (locationCompetitors.length > 0) {
          // Calculate center point from competitors for this location
          const avgLat = locationCompetitors.reduce((sum: number, comp: any) => sum + comp.lat, 0) / locationCompetitors.length;
          const avgLng = locationCompetitors.reduce((sum: number, comp: any) => sum + comp.lng, 0) / locationCompetitors.length;
          
          currentLocation = {
            name: selectedLocations[0],
            lat: avgLat,
            lng: avgLng,
            address: `${selectedLocations[0]} Senior Living Community`
          };
        }
      }
      
      // Fallback to first competitor's area if no specific location or multiple locations
      if (!currentLocation && competitorData.items.length > 0) {
        const firstComp = competitorData.items[0];
        currentLocation = {
          name: firstComp.location || "Selected Location",
          lat: firstComp.lat + (Math.random() - 0.5) * 0.01, // Slight offset from competitor
          lng: firstComp.lng + (Math.random() - 0.5) * 0.01,
          address: `${firstComp.location || "Senior Living"} Community`
        };
      }
      
      // Set up portfolio property data for use in comparisons
      // This will be used by competitor popups even if we don't show a portfolio marker
      const currentProperty = currentLocation && currentLocation.lat && currentLocation.lng ? {
        name: currentLocation.name,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        rates: { "Studio": 3175, "One Bedroom": 4200, "Two Bedroom": 5100, "Memory Care": 4800 },
        avgRate: 3800,
        avgCareRate: 775,
        address: currentLocation.address
      } : {
        // Default values when no valid location
        name: "Portfolio Average",
        lat: 38.2527,
        lng: -85.7585,
        rates: { "Studio": 3175, "One Bedroom": 4200, "Two Bedroom": 5100, "Memory Care": 4800 },
        avgRate: 3800,
        avgCareRate: 775,
        address: "Portfolio Location"
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
        
        // Calculate portfolio metrics
        const primaryRate = currentProperty.rates.Studio || currentProperty.rates["One Bedroom"];
        const roomTypeLabel = currentProperty.rates.Studio ? 'Studio' : '1BR';
        const totalRate = primaryRate + currentProperty.avgCareRate;

        currentMarker.bindPopup(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 320px; max-width: 360px; padding: 0; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
          <!-- Header with gradient background -->
          <div style="background: linear-gradient(135deg, #0071e3 0%, #005bb5 100%); color: white; padding: 20px; position: relative;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <h3 style="margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.5px;">${currentProperty.name}</h3>
              <span style="background: rgba(255,255,255,0.2); color: white; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">YOUR PROPERTY</span>
            </div>
            <p style="margin: 0; font-size: 13px; opacity: 0.85; font-weight: 300;">Portfolio Location</p>
          </div>
          
          <!-- Main content with key metrics -->
          <div style="padding: 20px;">
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
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 600; color: #1e293b;">$${currentProperty.avgCareRate.toLocaleString()}</p>
                <p style="margin: 2px 0 0 0; font-size: 10px; color: #64748b;">Average</p>
              </div>
              
              <!-- Total -->
              <div style="text-align: center;">
                <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">TOTAL</p>
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: 600; color: #1e293b;">$${totalRate.toLocaleString()}</p>
                <p style="margin: 2px 0 0 0; font-size: 10px; color: #64748b;">Combined</p>
              </div>
            </div>
            
            <!-- Property Information Section -->
            <div style="background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="text-align: center;">
                <span style="font-size: 12px; color: #64748b; font-weight: 500;">Property Address</span>
                <p style="margin: 4px 0 0 0; font-size: 13px; font-weight: 500; color: #1e293b;">${currentProperty.address}</p>
              </div>
            </div>
            
            <!-- Room Types Grid -->
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
              ${Object.entries(currentProperty.rates).map(([roomType, rate]) => `
                <div style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #e2e8f0;">
                  <span style="font-size: 10px;">${roomType}:</span>
                  <span style="font-weight: 600;">$${Number(rate).toLocaleString()}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `);
      } // End of if block for currentLocation check
      
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
        let roomTypeLabel = isHC ? 'HC Rate' : 'Avg Rate';
        if (!isHC && competitor.rates && typeof competitor.rates === 'object') {
          if (competitor.rates.Studio || competitor.rates.studio) {
            primaryRate = competitor.rates.Studio || competitor.rates.studio;
            roomTypeLabel = 'Studio';
          } else if (competitor.rates['One Bedroom'] || competitor.rates.oneBedroom) {
            primaryRate = competitor.rates['One Bedroom'] || competitor.rates.oneBedroom;
            roomTypeLabel = '1BR';
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
                <span style="background: ${style.color}20; color: ${style.color}; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;">${competitor.rating || 'N/A'}</span>
              </div>
              <p style="margin: 0; font-size: 13px; opacity: 0.85; font-weight: 300;">Competitor Location</p>
            </div>
            
            <!-- Main content with key metrics -->
            <div style="padding: 20px;">
              <!-- Service Line Badge -->
              ${isHC ? `
              <div style="display: inline-block; background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">
                HC - Daily Rates
              </div>
              ` : `
              <div style="display: inline-block; background: #dbeafe; border: 1px solid #60a5fa; color: #1e3a8a; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">
                ${competitor.serviceLine || 'AL'} - Monthly Rates
              </div>
              `}
              
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
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                <a href="${googleMapsUrl}" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; transition: all 0.2s; border: 1px solid #e2e8f0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  View Location
                </a>
                <a href="${directionsUrl}" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; background: #f1f5f9; color: #475569; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; transition: all 0.2s; border: 1px solid #e2e8f0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l14 0"/><path d="M13 5l7 7-7 7"/></svg>
                  Get Directions
                </a>
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
      
      // Set map view based on current location and competitors
      if (competitorData.items.length > 0) {
        // Create bounds including current property and all competitors
        const allPoints = [[currentProperty.lat, currentProperty.lng], ...competitorData.items.map((comp: any) => [comp.lat, comp.lng])];
        const bounds = window.L.latLngBounds(allPoints);
        
        // Fit map to show all markers with appropriate padding
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: [30, 30],
          maxZoom: 12 // Good zoom level for location view
        });
      } else {
        // No competitors, center on current location
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
            {competitors?.items?.length || 0} competitors found
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