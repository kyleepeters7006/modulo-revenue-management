# Overview

Modulo is a revenue management dashboard designed for real estate and senior living facilities. Its primary goal is to optimize rental revenue through dynamic pricing recommendations, comprehensive competitor analysis, and AI-driven insights. The application provides a competitive advantage by leveraging real-time data and advanced algorithms to enhance revenue across senior living portfolios.

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
- **Key Tables**: `rent_roll_data`, `locations`, `campus_maps`, `floor_plans`, `unit_polygons`, `assumptions`, `pricing_weights`, `competitors`, `guardrails`, `ml_models`, `inquiry_metrics`, `ai_rate_outcomes`, `ai_weight_versions`, `revenue_growth_targets`.

## Core Features
- **Dynamic Pricing Engine**: Multi-factor algorithm considering occupancy, vacancy, room attributes, seasonality, competitors, and market conditions, with a premium positioning strategy.
- **Mixed Rate Storage Model**: Stores HC and HC/MC rates as daily, while AL, SL, VIL, AL/MC rates are monthly, with backend conversion to monthly for consistent annualization.
- **Hierarchical Pricing Weights**: Granular control of pricing weights at the Location + Service Line level with a 3-tier fallback system.
- **Competitive Survey Import & Auto-Matching**: Imports wide-format Excel competitive survey data and automatically matches competitors to rent roll units using a job-based system.
- **Competitor Adjustment Service**: Calculates market-accurate competitor rates by adjusting for care level differences and medication management fees.
- **Service Line & Room Type Mapping**: Intelligent mapping system for normalizing service lines and room types for accurate matching.
- **Auto-Generated Floor Plan System**: Creates interactive SVG floor plans with grid-based layouts, color-coded occupancy status, and unit metadata.
- **Interactive Floor Plan Booking System**: Drag-and-drop unit assignment, automatic polygon detection, and interactive tooltips.
- **Data Import System**: Transaction-safe CSV upload and parsing for rent roll data with duplicate prevention and fuzzy matching, including multi-file upload capabilities with live progress tracking and error handling.
- **Guardrails System**: Configurable pricing constraints and safety limits.
- **Revenue Forecasting**: Real-time revenue calculations using actual in-house rates for occupied units and street rates for vacant units, displayed as time-series growth charts.
- **Calculation History Tracking**: Persistent storage of all Modulo/AI rate calculations.
- **Automated Daily Calculations**: Portfolio-wide Modulo calculations run automatically daily.
- **Persistent Rate Storage**: All calculated rates are saved directly to the `rent_roll_data` table.
- **Competitor Analysis**: Interactive Leaflet map integration with service line filtering and improved geocoding.
- **Explanation System**: Calculation dialogs present mathematical formulas and narrative explanations for pricing factors.
- **Room Attributes & Pricing Page**: Manages and analyzes attribute-based pricing.
- **Global Floor Plan Templates**: Floor plans can be uploaded as global templates.
- **Attribute Pricing Service Integration**: Separates attribute pricing from the main Modulo algorithm.
- **Inquiry Data Persistence**: Stores aggregated inquiry data by location, service line, and lead source.
- **Trilogy-Specific Column Mapping**: Supports custom column mappings for rent roll uploads and intelligent attribute parsing.
- **Smart Location Filtering**: Location/region/division dropdowns automatically filter to show only locations with relevant data.
- **ML Learning System**: Self-improving pricing weights through supervised learning, including outcome tracking, adoption detection, sales tracking, regularized regression training, version control, and an automated daily learning loop.
- **Flexible Import Mapping Service**: Comprehensive column mapping system for CSV/Excel uploads with built-in profiles, fuzzy matching, field aliases, value transformations, and custom profile saving.
- **AI Integration**: Utilizes GPT-5 (version 5.2) for AI Pricing Engine, Floor Plan Detection, MatrixCare Export Validation, Room Detection Service, AI Insights, Pricing Rule Validation, and Target Revenue Growth Generation.
- **Target Annual Revenue Growth**: AI-powered settings generator on Pricing Controls page that analyzes portfolio metrics (occupancy, vacancy patterns, sales velocity, competitor rates, service line breakdown) and generates optimal pricing weights, guardrails, and attribute adjustments to achieve user-defined revenue growth targets per service line. Includes Save Targets button to persist target percentages by location and service line combination (stored in `revenue_growth_targets` table).
- **Optimized Room Attributes**: Redesigned Room Attributes page with unified filter bar and "Preview Impact" functionality.
- **RRA Analytics**: Room Rate Adjustment (RRA) tracking on Pricing Analytics page. Analyzes T3 (trailing 3-month) discount trends by service line and location, showing discount rates, average discount amounts, and total discount volumes. Import reads `Room_Rate_Adjustments` column from KeyStats data.

# External Dependencies

## Core Runtime
- **@neondatabase/serverless**: PostgreSQL serverless driver
- **drizzle-orm**: Type-safe ORM
- **@tanstack/react-query**: Server state management
- **express**: Web application framework
- **multer & papaparse**: File upload and CSV parsing
- **openai**: OpenAI GPT-5 Vision API integration

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

# Database Backup & Migration

## Backup Options
1. **Replit Rollback** - Use Replit's built-in checkpoint system to restore database to a previous state (select "Database" under Additional rollback options)
2. **pg_dump Export** - Create a portable backup file:
   ```bash
   pg_dump -Fc -v -d "$DATABASE_URL" -f backup_$(date +%F).dump
   ```
3. **pg_restore** - Restore from backup:
   ```bash
   pg_restore -v -d "$DATABASE_URL" backup.dump
   ```

## Key Database Tables
- `rent_roll_data` - Main unit/occupancy data (~391,000 records)
- `rent_roll_history` - Historical snapshots for trend analysis
- `locations` - Facility/campus information
- `competitors` - Competitor rate data
- `pricing_weights` - Hierarchical pricing configuration
- `guardrails` - Min/max rate constraints
- `ai_rate_outcomes` - AI pricing adoption tracking

## Migration to External Servers
1. Export database using pg_dump
2. Copy the codebase from GitHub
3. Set environment variables: DATABASE_URL, OPENAI_API_KEY
4. Run `npm install` and `npm run db:push` to sync schema
5. Import data using pg_restore

## Important Notes
- Publishing the app does NOT expose database contents - only the application interface
- Database remains on Neon serverless PostgreSQL
- For production deployment, configure HTTPS and authentication

# GitHub Export Security

## Excluded from Version Control
The following files are excluded via `.gitignore` to protect sensitive data:
- `attached_assets/*.xlsx` - Financial spreadsheets, competitive surveys, rent roll exports
- `attached_assets/*.csv` - Data exports and imports
- `attached_assets/*.pdf` - Floor plans and documents
- `attached_assets/*.pptx` - Presentations
- `*.dump` - Database backup files
- `.env*` - Environment variables and secrets

## What IS Included
- Stock images (`attached_assets/stock_images/`)
- Default floor plan image
- Modulo logo
- All application source code
- Configuration files (drizzle, vite, tailwind)

## Before GitHub Export
1. Verify `.gitignore` excludes sensitive files
2. Run `git status` to confirm no sensitive files are staged
3. Set up environment variables on the target server:
   - `DATABASE_URL` - PostgreSQL connection string
   - `OPENAI_API_KEY` - For AI features
   - `SESSION_SECRET` - For authentication