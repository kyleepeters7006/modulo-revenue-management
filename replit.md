# Overview

This is a revenue management dashboard application called "Modulo" built for real estate/senior living facilities. The system provides dynamic pricing recommendations, competitor analysis, and AI-powered insights to optimize rental revenue. It features a modern React frontend with a comprehensive dashboard interface, Express.js backend with RESTful APIs, and PostgreSQL database integration through Drizzle ORM.

# User Preferences

Preferred communication style: Simple, everyday language.

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
  - `rent_roll_data` for property unit information
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