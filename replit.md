# Overview

This project, "Modulo," is a revenue management dashboard for real estate/senior living facilities. It provides dynamic pricing recommendations, competitor analysis, and AI-powered insights to optimize rental revenue. The application features a React frontend, an Express.js backend with RESTful APIs, and a PostgreSQL database utilizing Drizzle ORM. Modulo aims to optimize revenue across senior living portfolios by leveraging real-time data and advanced algorithms, providing a competitive edge in the market.

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
- **Dynamic Pricing Engine**: Multi-factor algorithm considering occupancy, vacancy, room attributes, seasonality, competitors, and market conditions. This includes a premium positioning strategy where AL units target 25% above market, IL targets 10%, HC/AL-MC target 20%, and others 18%. It also incorporates service-line-specific occupancy and benchmark data.
- **AI-Powered Floor Plan System**: Integration with OpenAI Vision API for automatic room detection and mapping on floor plans, including an admin interface for auto-mapping.
- **Interactive Floor Plan Booking System**: Drag-and-drop unit assignment, automatic polygon detection, visual feedback, and interactive tooltips with booking dialogs.
- **Data Import System**: Transaction-safe CSV upload and parsing for rent roll data with duplicate prevention and fuzzy matching for location mapping. Includes a clean data management UI.
- **Guardrails System**: Configurable pricing constraints and safety limits.
- **Revenue Forecasting**: Time-series projection against S&P 500 returns.
- **Competitor Analysis**: Interactive Leaflet map integration.
- **Explanation System**: Calculation dialogs display mathematical formulas first, followed by narrative sentence explanations for all pricing factors and manual rules.

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