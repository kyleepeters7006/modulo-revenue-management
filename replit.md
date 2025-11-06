# Overview

This is a revenue management dashboard application called "Modulo" built for real estate/senior living facilities. The system provides dynamic pricing recommendations, competitor analysis, and AI-powered insights to optimize rental revenue. It features a modern React frontend with a comprehensive dashboard interface, Express.js backend with RESTful APIs, and PostgreSQL database integration through Drizzle ORM.

# User Preferences

Preferred communication style: Simple, everyday language.

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