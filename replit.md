# Overview

This is a revenue management dashboard application called "Modulo" built for real estate/senior living facilities. The system provides dynamic pricing recommendations, competitor analysis, and AI-powered insights to optimize rental revenue. It features a modern React frontend with a comprehensive dashboard interface, Express.js backend with RESTful APIs, and PostgreSQL database integration through Drizzle ORM.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes (November 16, 2024)

## Real Trilogy Portfolio Data on Overview Page
- **Removed Demo Data**: Overview page now displays actual portfolio metrics from database
- **Real Metrics**: Shows actual 3,259 units across 31 Trilogy campuses with real occupancy rates
- **Accurate Revenue**: Calculates current and potential revenue from actual rent roll data
- **Live Statistics**: Real-time occupancy breakdown by room type and service line

# Recent Changes (November 16, 2024)

## Production Data Import System
- **Database Schema**: Added tables for rentRollHistory, enquireData, competitiveSurveyData, and locationMappings
- **Import Pipeline**: Transaction-safe import system with duplicate prevention for 11 months of historical rent roll data (190k+ records)
- **Clean Data Management UI**: Simplified table layout with Category, File Selection, Records Count, and Import/Export actions
- **Enquire Integration**: Updated Modulo pricing algorithm to use real inquiry/tour data from database instead of mock values
- **Location Mapping**: Fuzzy matching algorithm for auto-mapping Enquire records to campus locations
- **CSV Export**: Full export functionality for all production data tables for verification and external analysis
- **Admin Interface**: Navigate to `/data-import` for clean, simple data management interface

# Recent Changes (November 9, 2024)

## Market Positioning Strategy Update
- **Premium Targeting**: Changed competitor algorithm from price-matching to premium positioning strategy
- **Service-Line-Specific Targets**: AL units target 25% above market, IL targets 10%, HC/AL-MC target 20%, others default to 18%
- **Algorithm Logic**: Price adjustments now drive toward target premium instead of converging to competitor median
- **Impact**: Replaces the old "89.4% of market" positioning with strategic premium positioning across service lines
- **UI Updates**: Calculation dialogs now show "Target Premium", "Current Position", and "Premium Gap" for transparency

## Service-Line Occupancy Bug Fix
- **Root Cause**: Occupancy adjustment was incorrectly using campus-level occupancy (87%) instead of service-line-specific occupancy
- **Impact**: AL units with 91% AL occupancy were showing negative occupancy adjustments when they should have been positive (above 90% target)
- **Fix**: Updated pricing algorithm to calculate and use service-line-specific occupancy rates for AL, HC, IL, AL/MC, etc.
- **Affected Endpoints**: Fixed in 3 locations - Modulo recalculation, AI batch suggestions, and AI single-unit calculation
- **Result**: Occupancy pressure now correctly reflects each service line's performance against the 90% target

## UI Scroll Fix
- **Booking Dialog**: Added scroll functionality (`max-h-[85vh] overflow-y-auto`) to prevent content cutoff in floor plan booking popups

## Interactive Floor Plan Booking System
- **Drag-and-Drop Unit Assignment**: Complete system for linking units to floor plan polygons via drag-and-drop from unit list to canvas
- **Automatic Polygon Detection**: Centroid-based nearest-neighbor matching with 100px snap radius for dropped units
- **Visual Feedback**: Candidate polygons rendered with dashed cyan outlines, room number labels at centroids, and drag-over highlighting
- **Interactive Tooltips**: Hover tooltips now include "Book Now" button (or "Join Waitlist" for occupied units) that opens booking dialog
- **Smart Booking Dialog**: Displays full unit details (room number, type, size, current rate, Modulo suggested rate, vacancy status) with conditional CTAs
- **Dual Interaction Modes**: Tooltip button and polygon click both open booking dialog; booking disabled in edit mode to prevent accidental bookings
- **60/40 Split Layout**: Floor plan editor shows canvas on left (60%) and draggable unit list on right (40%) for efficient unit assignment workflow

# Recent Changes (November 8, 2024)

## Analytics Scatter Plot Improvements
- **Sticky Tooltips**: Clicking scatter plot dots now keeps tooltips open (pinned state) enabling access to "Edit Pricing" button
- **Interactive Tooltips**: Tooltips support pointer-events for hovering over buttons and clickable elements
- **Click-Outside Dismiss**: Clicking elsewhere on the chart dismisses pinned tooltips for clean UX

## Critical HC Pricing Bug Fix
- **Root Cause Identified**: Competitor variance guardrail was forcing HC units (street rate ~$10,000) to stay within ±10% of competitor rates (~$4,500 AL-level data), causing 50% price cuts
- **Service-Line Median Benchmarking**: Changed algorithm to use each service line's own median street rate as competitive benchmark instead of external competitor data (HC: $8,820, AL: $3,704, AL/MC: $4,459, IL: $3,000)
- **Guardrail Fix**: Disabled competitor variance guardrail that was inappropriately applying cross-service-line constraints
- **Results**: HC pricing now shows realistic +7.0% average adjustment (was -49.9%), with algorithm correctly calculating adjustments within ±25% bounds
- **Data Flow Validation**: Added debug logging to trace price calculations from algorithm through guardrails to database, confirming algorithm integrity

# Recent Changes (November 7, 2024)

## Formula + Sentence Explanation System
- **Dual Explanation Format**: All calculation dialogs now display both mathematical formulas FIRST, then narrative sentence explanations
- **Formula Display**: Each pricing factor shows its calculation formula in a monospace code block (e.g., "Signal (-12.5%) × Weight (25%) = -3.1%")
- **Sentence Explanations**: Following each formula, contextual narrative explains the business reasoning and impact
- **Manual Rules Preservation**: Manual adjustment rules continue to override Modulo and are shown separately in purple cards with both formula and explanation
- **Consistent UI**: Formula-then-sentence pattern applied to Modulo calculations, AI calculations, and manual rules
- **File Structure**: Formulas from `moduloPricingAlgorithm.ts` + sentences from `sentenceExplanations.ts`

## Advanced Pricing Algorithm Implementation
- **Sophisticated Multi-Signal Algorithm**: Implemented advanced pricing algorithm with signal normalization and bounded adjustments
- **Occupancy Pressure Tiers**: Three-tier system with hard floor at 85% (strong cuts below), target at 90%, and premiums above
- **Exponential Vacancy Decay**: 7-day grace period followed by smooth exponential decay to -15% maximum discount
- **Z-Score Demand Analysis**: Statistical demand signal using z-score comparison to historical averages
- **Bounded Adjustments**: Global caps at -25%/+25% with individual factor limits for stability
- **Signal Blending**: Normalized signals (-1 to +1) with weighted blending for balanced price recommendations

# Recent Changes (November 6, 2024)

## Pricing Algorithm Improvements for Senior Housing Industry
- **Fixed Occupancy Pressure Logic**: Corrected to use 95% target occupancy (industry standard). High occupancy now properly increases rates, low occupancy decreases rates
- **Updated Days Vacant Decay**: Implemented stepped discounts (0% for 0-30 days, 5% for 31-60 days, 10% for 61-90 days, 15% for 90+ days) to prevent excessive discounting
- **Reduced Stock Market Factor**: Renamed to "Economic Indicators" with reduced weight (5% vs 10%) as it has limited relevance for senior housing pricing
- **Improved Inquiry & Tour Volume**: Updated to use more realistic senior housing activity levels (3 inquiries, 2 tours typical) with campus-specific baselines
- **Enhanced Pricing Calculation Modal**: Separated Modulo algorithm results from manual adjustment rules with clear subtotals - manual rules now shown in purple card as overrides
- **UI Layout Improvements**: Moved Pricing Change History to bottom of Rate Card page for better flow

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Library**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom dark theme variables optimized for dashboard interfaces
- **State Management**: TanStack React Query for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Charts**: Recharts for data visualization and revenue comparison charts
- **Forms**: React Hook Form with Zod validation for type-safe form handling

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM for type-safe database operations
- **File Processing**: Multer for CSV file uploads with Papa Parse for parsing rent roll data
- **Session Management**: Express sessions with PostgreSQL session store
- **Development**: Hot module replacement via Vite integration in development mode

## Database Design
- **Primary Database**: PostgreSQL with connection pooling via Neon serverless driver
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Key Tables**: 
  - `rent_roll_data` for property unit information (2,941 units across 31 campuses)
  - `locations` for Trilogy campus/facility master data
  - `campus_maps` for SVG floor plan images linked to locations
  - `floor_plans` for reusable floor plan templates (e.g., "Sycamore Studio", "Maple 1BR")
  - `unit_polygons` for clickable SVG polygon mappings to rent_roll_data units
  - `assumptions` for financial modeling parameters  
  - `pricing_weights` for algorithm configuration
  - `competitors` for market comparison data
  - `guardrails` for pricing constraint rules
  - `ml_models` for machine learning model storage

## Core Features Architecture
- **Dynamic Pricing Engine**: Multi-factor algorithm considering occupancy pressure, vacancy duration, room attributes, seasonality, competitor rates, and market conditions
- **Revenue Forecasting**: Time-series projection comparing property performance against S&P 500 returns
- **Competitor Analysis**: Interactive Leaflet map integration for geographical market analysis
- **AI Insights**: Mock AI analysis system for generating pricing recommendations and market insights
- **ML Training Pipeline**: Placeholder machine learning model training system for predictive pricing
- **Data Import System**: CSV upload and parsing for rent roll data with validation
- **Guardrails System**: Configurable pricing constraints and safety limits
- **Floor Plan Management**: Interactive floor plan viewer with Engrain SiteMap-style photorealistic maps
  - Campus Maps: Photorealistic aerial/satellite base images with SVG polygon overlays for interactivity
  - Base Image System: `base_image_url` field stores path to high-resolution floor plan images (1024x683)
  - Floor Plan Templates: Reusable templates for room types (Studio, 1BR, 2BR, Semi-Private, etc.)
  - Unit Polygons: Clickable SVG polygon regions positioned over base image, linked to rent_roll_data units
  - Color-Coded Rooms: Red (#ff6b6b), Yellow (#ffd93d), and Green (#6bcf7f) polygons for different room types
  - Integration: Full integration with existing pricing and availability data via hover tooltips
  - Demo Data: Kokomo-106 (28 interactive units) and Springfield-401 (28 interactive units) campuses
  - Hybrid Architecture: Photorealistic image base layer + SVG interactive overlay layer for professional aesthetic

## Component Architecture
- **Dashboard Layout**: Responsive design with collapsible sidebar navigation
- **Modular Components**: Reusable UI components for metrics, charts, data tables, and forms
- **Real-time Updates**: Periodic data refresh with optimistic UI updates
- **Mobile Responsiveness**: Adaptive layout with mobile-specific navigation patterns

# External Dependencies

## Core Runtime Dependencies
- **@neondatabase/serverless**: PostgreSQL serverless driver for database connectivity
- **drizzle-orm**: Type-safe ORM for database operations and query building
- **@tanstack/react-query**: Server state management and data fetching
- **express**: Web application framework for REST API endpoints
- **multer & papaparse**: File upload processing and CSV parsing capabilities

## UI and Visualization
- **@radix-ui/***: Headless UI component primitives for accessibility
- **recharts**: Charting library for revenue and performance visualization
- **tailwindcss**: Utility-first CSS framework for styling
- **lucide-react**: Icon library for consistent UI iconography
- **leaflet**: Interactive maps for competitor geographical analysis (loaded dynamically)

## Development Tools
- **vite**: Fast build tool and development server
- **typescript**: Static type checking and improved developer experience
- **drizzle-kit**: Database schema management and migration tools
- **tsx**: TypeScript execution for server-side development

## Form Handling and Validation
- **react-hook-form**: Performant form library with minimal re-renders
- **@hookform/resolvers**: Integration layer for validation libraries
- **zod**: Schema validation for type-safe data processing
- **drizzle-zod**: Integration between Drizzle ORM and Zod validation