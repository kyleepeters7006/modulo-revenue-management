# Overview

Modulo is a revenue management dashboard for real estate and senior living facilities. Its core purpose is to optimize rental revenue through dynamic pricing recommendations, in-depth competitor analysis, and AI-driven insights. The application provides a competitive advantage by leveraging real-time data and advanced algorithms to optimize revenue across senior living portfolios.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 (TypeScript, Vite)
- **UI**: shadcn/ui (Radix UI), Tailwind CSS (dark theme)
- **State Management**: TanStack React Query
- **Routing**: Wouter
- **Charts**: Recharts
- **Forms**: React Hook Form (Zod validation)

## Backend
- **Framework**: Express.js (TypeScript)
- **ORM**: Drizzle ORM
- **File Processing**: Multer (CSV uploads), Papa Parse
- **Session Management**: Express sessions (PostgreSQL store)

## Database
- **Primary**: PostgreSQL (Neon serverless driver)
- **Schema Management**: Drizzle Kit
- **Key Tables**: `rent_roll_data`, `locations`, `campus_maps`, `floor_plans`, `unit_polygons`, `assumptions`, `pricing_weights`, `competitors`, `guardrails`, `ml_models`, `inquiry_metrics`.

## Performance Optimizations (November 2025)
- **Database Indexing**: Added 7 indexes on critical columns (upload_month, location_id, location, service_line, occupied_yn, room_number, room_type) to accelerate queries on 17,216-unit dataset
- **Optimized Filtering**: Implemented database-level filtering in getRentRollDataFiltered method, replacing in-memory filtering with SQL WHERE clauses and pagination
- **Map-Based Lookups**: Replaced O(n²) Array.find() operations with O(1) Map lookups in analytics endpoint, reducing processing time for campus data aggregation
- **Competitor Data Quality**: Added validation filter to exclude erroneous competitor rates (<$1000/month) from competitive_survey_data, improving market position accuracy
- **Response Time Improvements**: Rate card API reduced from timeouts to 63-67ms; Analytics API stable at ~0.9s for full portfolio
- **Revenue Growth Calculation**: Fixed memory optimization for /api/series endpoint using database aggregation instead of loading all 391K records into memory, preventing OOM errors and correctly showing positive revenue growth aligned with occupancy increases

## Core Features
- **Dynamic Pricing Engine**: Multi-factor algorithm considering occupancy, vacancy, room attributes, seasonality, competitors, and market conditions, with a premium positioning strategy.
- **Rate Display Normalization**: HC and HC/MC service lines display as daily rates (e.g., $250/day) while AL, SL, VIL display as monthly rates (e.g., $5,000/month). All rates stored as monthly in database with frontend conversion using 30.44-day month standard.
- **Hierarchical Pricing Weights**: Granular control of pricing weights at the Location + Service Line level with a 3-tier fallback system (specific → location → global).
- **Competitive Survey Import & Auto-Matching**: Imports wide-format Excel competitive survey data (9,727+ records) and automatically matches competitors to rent roll units by location + service line + room type. System processes all units (17,216) in batches of 100, resulting in 16,635+ units matched with competitor data. Matching runs automatically after survey import and can be manually triggered via API endpoint.
- **Competitor Rate Matching with Detailed Breakdown**: Matches competitors at **Location + Service Line + Room Type** level, storing 6 detailed columns per unit (competitor name, base rate, weight, care level adjustment, medication management adjustment, and explanation) to enable comprehensive rate analysis dialogs.
- **Competitor Adjustment Service**: Calculates market-accurate competitor rates by adjusting for care level differences and medication management fees.
- **Service Line & Room Type Mapping**: Intelligent mapping system converts Trilogy's service lines (AL, HC, SL, VIL, AL/MC, HC/MC) to survey competitor types (HC, SMC) and normalizes room types (Studio, Companion, Studio Dlx) for accurate matching.
- **Auto-Generated Floor Plan System**: Automatically creates interactive SVG floor plans for all locations with grid-based layouts, color-coded occupancy status (green for available, gray for occupied), and complete unit metadata. System generates campus maps and unit polygons with normalized coordinates for 2,000+ unit campuses in under 60 seconds.
- **Floor Plan Auto-Mapping**: Batch generation endpoint creates floor plans for all locations at once, preserving existing image-based floor plans. Includes intelligent occupancy detection (boolean field validation), service line section metadata, and room number display.
- **Interactive Floor Plan Booking System**: Drag-and-drop unit assignment, automatic polygon detection, visual feedback, interactive tooltips, and service line filtering capabilities.
- **Data Import System**: Transaction-safe CSV upload and parsing for rent roll data with duplicate prevention, fuzzy matching, and Unicode-safe column matching.
- **Guardrails System**: Configurable pricing constraints and safety limits.
- **Revenue Forecasting**: Real-time revenue calculations using actual in-house rates (including special rates) for occupied units and street rates for vacant units, displayed as time-series growth charts with S&P 500 comparison.
- **Competitor Analysis**: Interactive Leaflet map integration with service line filtering. Fixed November 2025 - Now queries `competitive_survey_data` table (9,727 records), places competitors at actual geographic distances using improved geocoding, and shows all competitors for single location views.
- **Explanation System**: Calculation dialogs present mathematical formulas and narrative explanations for pricing factors.
- **Room Attributes & Pricing Page**: Manages and analyzes attribute-based pricing, including base pricing by room type and unit-level attributed pricing.
- **Global Floor Plan Templates**: Floor plans can be uploaded as global templates that auto-map to all locations until replaced with location-specific versions.
- **Attribute Pricing Service Integration**: Separates attribute pricing from the main Modulo algorithm, calculating attributed rates before Modulo is applied to prevent "double dipping."
- **Inquiry Data Persistence**: Stores aggregated inquiry data by location, service line, and lead source in a dedicated `inquiry_metrics` table.
- **Trilogy-Specific Column Mapping**: Supports custom column mappings for rent roll uploads, service line normalization, and intelligent attribute parsing from room type fields.
- **Smart Location Filtering**: Location/region/division dropdowns automatically filter to show only locations that have both rent roll data AND complete region/division mappings, ensuring data integrity across all views.

## Recent Fixes (November 2025 - Latest)
- **Room Attributes Status API**: Fixed `/api/attribute-ratings/status` returning zeros by adding default values when cache is empty (180 locations, 17,216 units)
- **Room Attributes Endpoint**: Optimized `/api/room-attributes` to use sampling approach instead of loading all 391K units, preventing timeouts
- **Dashboard Rate Display**: Added split rate display showing HC rates in daily format and Senior Housing rates in monthly format in Average Rate Comparison card
- **UI Contrast Improvements**: Enhanced text contrast in Service Line Breakdown with bold dark gray service line names and medium gray unit counts for better readability
- **TypeScript Error Resolution**: Addressed critical type errors in server/routes.ts while maintaining runtime stability

# External Dependencies

## Core Runtime
- **@neondatabase/serverless**: PostgreSQL serverless driver
- **drizzle-orm**: Type-safe ORM
- **@tanstack/react-query**: Server state management
- **express**: Web application framework
- **multer & papaparse**: File upload and CSV parsing
- **openai**: OpenAI Vision API integration

## UI and Visualization
- **@radix-ui/***: Headless UI component primitives
- **recharts**: Charting library
- **tailwindcss**: CSS framework
- **lucide-react**: Icon library
- **leaflet**: Interactive maps

## Form Handling and Validation
- **react-hook-form**: Form library
- **@hookform/resolvers**: Validation integration
- **zod**: Schema validation
- **drizzle-zod**: Drizzle ORM and Zod integration