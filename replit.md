# Overview

Modulo is a revenue management dashboard designed for real estate and senior living facilities. Its primary purpose is to optimize rental revenue through dynamic pricing recommendations, in-depth competitor analysis, and AI-driven insights. The application provides a competitive edge by leveraging real-time data and advanced algorithms to optimize revenue across senior living portfolios.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite.
- **UI Library**: shadcn/ui built on Radix UI primitives.
- **Styling**: Tailwind CSS with a custom dark theme.
- **State Management**: TanStack React Query for server state.
- **Routing**: Wouter for client-side routing.
- **Charts**: Recharts for data visualization.
- **Forms**: React Hook Form with Zod validation.

## Backend Architecture
- **Framework**: Express.js with TypeScript.
- **Database ORM**: Drizzle ORM for type-safe operations.
- **File Processing**: Multer for CSV uploads and Papa Parse for parsing.
- **Session Management**: Express sessions with PostgreSQL store.

## Database Design
- **Primary Database**: PostgreSQL with Neon serverless driver.
- **Schema Management**: Drizzle Kit for migrations.
- **Key Tables**: `rent_roll_data`, `locations`, `campus_maps`, `floor_plans`, `unit_polygons`, `assumptions`, `pricing_weights`, `competitors`, `guardrails`, `ml_models`.

## Core Features Architecture
- **Dynamic Pricing Engine**: A multi-factor algorithm that considers occupancy, vacancy, room attributes, seasonality, competitors, and market conditions. It includes a premium positioning strategy and service-line-specific occupancy and benchmark data.
- **Hierarchical Pricing Weights**: Supports granular control of pricing weights at the Location + Service Line level with a 3-tier fallback system (specific → location → global). The algorithm pre-caches weights for efficiency.
- **Competitor Adjustment Service**: Calculates market-accurate competitor rates by adjusting for care level 2 differences and medication management fees to ensure fair comparisons.
- **AI-Powered Floor Plan System**: Integrates with OpenAI Vision API for automatic room detection and mapping on floor plans, including an administrative interface.
- **Interactive Floor Plan Booking System**: Features drag-and-drop unit assignment, automatic polygon detection, visual feedback, and interactive tooltips with booking dialogs.
- **Data Import System**: Provides transaction-safe CSV upload and parsing for rent roll data with duplicate prevention and fuzzy matching, managed through a clean UI.
- **Guardrails System**: Configurable pricing constraints and safety limits.
- **Revenue Forecasting**: Real-time aggregation of rent roll data for time-series comparisons.
- **Competitor Analysis**: Interactive Leaflet map integration with service line filtering.
- **Explanation System**: Calculation dialogs present mathematical formulas and narrative explanations for pricing factors and rules.
- **Room Attributes & Pricing Page**: A dedicated page for managing and analyzing attribute-based pricing, including base pricing by room type and unit-level attributed pricing.

# External Dependencies

## Core Runtime Dependencies
- **@neondatabase/serverless**: PostgreSQL serverless driver.
- **drizzle-orm**: Type-safe ORM.
- **@tanstack/react-query**: Server state management.
- **express**: Web application framework.
- **multer & papaparse**: File upload and CSV parsing.

## UI and Visualization
- **@radix-ui/***: Headless UI component primitives.
- **recharts**: Charting library.
- **tailwindcss**: CSS framework.
- **lucide-react**: Icon library.
- **leaflet**: Interactive maps (loaded dynamically).

## Form Handling and Validation
- **react-hook-form**: Form library.
- **@hookform/resolvers**: Validation integration.
- **zod**: Schema validation.
- **drizzle-zod**: Drizzle ORM and Zod integration.

# Recent Changes (November 20, 2025)

## AttributePricingService Integration - COMPLETE ✅

### Critical Architectural Change: Separated Attribute Pricing from Modulo Algorithm
- **Goal**: Eliminate "double dipping" where attributes were counted twice in pricing calculations
- **Solution**: Calculate attributed rates BEFORE Modulo algorithm, then run Modulo on attributed base rates
- **Implementation Status**: Production-ready, architect-approved

### New Pricing Pipeline Architecture
```
1. Unit Base Rate (from AttributePricingService with 3-tier fallback)
   ↓
2. Apply Attribute Multipliers (A/B/C/D/E/F ratings for location, size, view, renovation, amenity)
   ↓
3. Attributed Rate (base rate adjusted for unit-specific attributes)
   ↓
4. Modulo Algorithm (6 signals: occupancy, daysVacant, seasonality, competitors, market, demand)
   ↓
5. Guardrails (min/max rate limits)
   ↓
6. Final Price (with complete calculation transparency)
```

### Schema Changes
- **Removed `roomAttributes` from pricing_weights table**: Attributes no longer part of Modulo weighting
- **Redistributed weights to 6 factors**: occupancy, daysVacant, seasonality, competitors, market, demand (total=100%)
- **Frontend updated**: Removed attribute weight slider from pricing weights UI

### New Services & Modules
- **pricingOrchestrator.ts**: Orchestrates the complete pricing pipeline with month-aware caching
- **Enhanced AttributePricingService**: 
  - 3-tier fallback strategy: segment cache → campus/service-line median → floor ($2500)
  - Month-specific cache tracking to prevent stale data
  - Automatic cache invalidation on rent roll uploads
  - Division-by-zero protection and defensive handling

### Calculation Details Enhancements
- **Full transparency**: Every pricing calculation now includes:
  - `baseRate`: Unit's base rate from cache
  - `baseRateSource`: How base rate was determined (segment/campus/floor)
  - `attributedRate`: Rate after applying attribute multipliers
  - `attributeBreakdown`: Detailed multiplier calculations for each attribute
  - `moduloDetails`: Breakdown of 6-signal Modulo calculation
  - `guardrailsApplied`: Metadata about rate limits (wasAdjusted, minAllowed, maxAllowed)
- **Unified schema**: Both Modulo and AI pricing endpoints return identical calculation structures

### Backend Updates
- **storage.ts**: Both `generateModuloPricingSuggestions()` and `generateAIPricingSuggestions()` use orchestrator
- **routes.ts**: 
  - `/api/pricing/generate-modulo`: Uses hierarchical weights lookup with orchestrator
  - `/api/pricing/generate-ai`: Uses same orchestrator with consistent schema
  - `/api/upload/rent-roll`: Invalidates attribute cache after successful upload
- **moduloPricingAlgorithm.ts**: Removed roomAttributes signal, now operates on 6 factors only

### Cache Management
- **Month-aware caching**: Cache tracks which month's data it contains
- **Automatic invalidation**: Rent roll uploads force cache refresh for uploaded month
- **Prevents staleness**: Re-uploading the same month's data correctly rebuilds base rates

### Testing & Validation
- ✅ Application running successfully with no errors
- ✅ All TypeScript/LSP errors resolved
- ✅ Cache properly invalidates on uploads
- ✅ Complete calculation details persisted to database
- ✅ AI and Modulo endpoints have unified schemas
- ✅ Architect approved: "Satisfies release criteria for attributed pricing before Modulo"

### Production Readiness
- **Status**: Ready for production deployment
- **Monitoring**: Track cache refresh logs after rent roll uploads
- **Next Steps**: 
  - Add automated regression tests for cache rebuild on same-month re-imports
  - Analytics consumers can leverage newly persisted attribute breakdown and guardrail metadata

## Critical Bug Fixes - Rent Roll Upload Parser

### Unicode-Safe Column Name Matching
- **Root Cause**: Excel-generated CSV files contain invisible Unicode characters (U+00A0 non-breaking spaces, etc.) in column headers that prevented exact string matching
- **Fix**: Implemented robust column normalization that:
  - Strips all Unicode whitespace characters (U+00A0, U+2000-U+200B, U+202F, U+205F, U+3000)
  - Removes punctuation and collapses whitespace
  - Handles case-insensitive matching
  - Uses two-pass matching: exact match first (fast), then normalized matching (robust)
- **Impact**: BaseRate1, competitor fields, and other CSV columns now parse correctly regardless of hidden characters

### Duplicate Data Prevention
- **Root Cause**: Upload route was appending data instead of replacing existing records for the same upload_month
- **Fix**: Changed to use `storage.uploadRentRollData()` which deletes existing month data before inserting
- **Impact**: Re-uploading a month now replaces old data instead of creating 15x duplicates (was 416K units, should be ~14K)

### Competitor Rate Field Mapping
- **Root Cause**: CSV columns use "Competitive" not "Competitor" (e.g., "Competitive Rate" vs "Competitor Rate")
- **Fix**: Added comprehensive column name variations:
  - competitorRate: 'Competitive Rate', 'competitive rate', 'Competitor Rate', 'competitor rate', 'CompetitiveRate', 'CompetitorRate'
  - competitorAvgCareRate: 'Competitive Average Care Rate', 'Competitive Avg Care Rate', etc.
  - competitorFinalRate: 'Competitive Final Rate', etc.
- **Validation**: Added debug logging to count records with competitor data and warn if none found
- **Impact**: Competitor rates should now populate from CSV instead of defaulting to $0

### Enhanced Debug Logging
- CSV header mapping now logs:
  - Original column headers
  - Normalized versions for troubleshooting
  - Sample of first row data
  - Competitor field validation counts
  - Warnings when expected fields are missing

### Inquiry Data Persistence Fix
- **Root Cause**: The `/api/upload/inquiry` route was only logging inquiry data to console, never saving it to the database
- **Impact**: All inquiry data uploaded via Data Management page (HC and Senior Housing datasets) were lost
- **Fix**: Created new `inquiry_metrics` table and implemented full data persistence:
  - Added `inquiry_metrics` table schema to store aggregated inquiry data by location, service line, and lead source
  - Fields include: inquiryCount, tourCount, conversionCount, conversionRate, daysToTour, daysToMoveIn
  - Implemented `storage.bulkInsertInquiryMetrics()` to save inquiry data (replaces existing month data to prevent duplicates)
  - Implemented `storage.getInquiryMetricsByMonth()` to retrieve inquiry metrics by month
  - Updated `/api/upload/inquiry` route to call storage methods and track upload history
- **Status**: Inquiry data now persists to database. Users must re-upload HC and Senior Housing inquiry datasets to restore lost data.

# Recent Changes (November 19, 2025)

## Trilogy-Specific Column Mapping and Attribute Parsing
- **Custom column mappings**: Rent roll upload now supports Trilogy's specific column names:
  - `Room_Bed` → Unit/Room Number
  - `BedTypeDesc` → Room Type (with embedded attributes)
  - `Service1` → Service Line (with normalization)
  - `BaseRate1` → Street Rate (also checks Base Rate, Rate, etc.)
  - `Textbox18` → Days Vacant
  - `PatientID1` → Used to determine occupancy (blank = vacant)
- **Service line normalization**: System automatically normalizes compound service lines to standard values:
  - "HC/TCU" → HC
  - "AL/MC" → AL
  - Ensures consistency with filter options (AL, HC, IL, MC, SL)
- **Intelligent attribute parsing**: System automatically extracts attribute ratings embedded in room type field:
  - "A Vw" → View Rating: A
  - "B Sz" → Size Rating: B
  - "A loc" → Location Rating: A
  - "C Reno" → Renovation Rating: C
  - "B Amen" → Amenity Rating: B
  - Supports ratings A-F with case-insensitive matching
- **Clean room type extraction**: After extracting attributes, the system stores a clean room type (e.g., "Studio A Vw B Sz" becomes "Studio" with viewRating: A and sizeRating: B)
- **Vacancy detection**: If PatientID1 field is blank or empty, the unit is automatically marked as vacant (occupiedYN: false)
- **Date selector for rent roll upload**: Added intelligent date selector that automatically parses dates from filenames (supports formats like 1.31.25, 01-31-2025, 2025-01-31, etc.) and pre-populates the upload date field
- **Column name flexibility**: Upload parser now handles both capitalized and lowercase column names (e.g., 'Room Number' or 'room number')
- **Extended field name matching**: Added multiple variations for BaseRate1 (Base Rate, Rate, etc.) to handle different CSV formats

