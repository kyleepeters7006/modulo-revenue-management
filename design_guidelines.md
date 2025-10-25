# Floor Plan Viewer Admin Page - Design Guidelines

## Design Approach

**System Selected:** Material Design adapted for enterprise dashboards, following existing Modulo patterns with shadcn/ui components. This admin interface prioritizes efficiency, data clarity, and tool accessibility over visual marketing elements.

**Justification:** Utility-focused administrative interface requiring clear information hierarchy, form management, file handling, and interactive drawing tools. Design consistency with existing Modulo dashboard is paramount.

## Core Design Elements

### Typography

**Font Family:** Inter (primary), JetBrains Mono (code/technical labels)

**Hierarchy:**
- Page Title: text-2xl font-semibold (32px)
- Section Headers: text-lg font-semibold (20px)
- Subsection Headers: text-base font-medium (16px)
- Body Text: text-sm font-normal (14px)
- Labels/Captions: text-xs font-medium (12px, uppercase tracking-wide for form labels)
- Technical Data: text-sm font-mono (file names, coordinates, SVG paths)

### Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8
- Component padding: p-6
- Section spacing: space-y-6
- Card spacing: p-4 or p-6
- Form field spacing: space-y-4
- Button padding: px-4 py-2
- Icon spacing: gap-2

**Grid System:**
- Main container: max-w-screen-2xl mx-auto px-8
- Two-column layout: 60/40 split (canvas/preview on left, controls on right)
- Three-column tool palette: grid-cols-3 gap-4

### Component Library

**Navigation & Structure:**
- Sidebar navigation (consistent with Modulo dashboard)
- Breadcrumb trail: Home > Floor Plans > Manage Templates
- Tab navigation for switching between Maps/Templates/Units modes
- Sticky header with page title and primary action button

**File Management:**
- Drag-and-drop upload zone with dashed border and upload icon
- File preview cards showing SVG thumbnails with metadata (name, size, upload date)
- Grid view (default): grid-cols-3 gap-6 for uploaded assets
- List view option: table format with sortable columns
- Delete/replace actions via icon buttons on hover

**Drawing & Canvas Tools:**
- Main canvas area with zoom controls (-, reset, +) in bottom-right corner
- Tool palette with icon buttons: Select, Polygon Draw, Edit Points, Delete, Pan
- Active tool state shown with teal accent border and background
- Floating properties panel showing selected polygon coordinates and unit linkage
- Grid overlay toggle for precise alignment
- Snap-to-grid option with configurable grid size input

**Forms & Inputs:**
- shadcn/ui Input components with floating labels
- Select dropdowns for floor/building selection
- Color-coded unit status badges (Available, Occupied, Reserved)
- Checkbox groups for polygon layer visibility
- Number inputs with steppers for coordinates/dimensions
- Search/filter bar with icon prefix

**Data Display:**
- Cards with subtle shadows (shadow-sm) for template thumbnails
- Data tables with alternating row colors for readability
- Status indicators using small circular badges
- Metadata displays in muted text (text-muted-foreground)
- Progress indicators for file uploads

**Interactive Elements:**
- Primary action buttons (teal background, white text)
- Secondary buttons (outline style)
- Destructive actions (red accent for delete)
- Toast notifications for save/upload confirmations
- Modal dialogs for delete confirmations and polygon-to-unit linking
- Context menus (right-click) on canvas for quick actions

**Polygon Drawing Interface:**
- Canvas workspace with white background and light grid
- Polygon outlines in teal (#14b8a6) with 2px stroke
- Selected polygons highlighted with thicker stroke and fill opacity
- Vertex handles as small circles for editing
- Info tooltip on hover showing linked unit details
- Layer panel listing all drawn polygons with visibility toggles

### Visual Treatment

**Trilogy Branding Integration:**
- Teal (#14b8a6): Primary actions, active states, polygon outlines, progress indicators
- Navy (#1e3a8a): Headers, important labels, selected sidebar items
- Neutral grays: Backgrounds (slate-50, slate-100), borders (slate-200), text (slate-600, slate-900)

**Card Design:**
- Background: white with rounded corners (rounded-lg)
- Border: 1px solid slate-200
- Subtle shadow on hover for interactive cards
- Header section with divider line

**Professional Aesthetic:**
- Clean, spacious layouts avoiding clutter
- Consistent 16px base unit for spacing harmony
- Restrained use of shadows and effects
- Clear visual hierarchy through size and weight, not color overload
- Accessibility-first contrast ratios

### Animations

**Minimal, Purposeful Motion:**
- Smooth transitions on hover states (transition-colors duration-200)
- Fade-in for modals and dropdowns
- No scroll-triggered animations or decorative effects
- Focus on functional feedback only

## Page Structure

**Three-Tab Layout:**

1. **Campus Maps Tab:**
   - Upload zone at top
   - Grid of uploaded SVG maps below
   - Each map card shows preview, name, actions (view, edit, delete)

2. **Floor Plan Templates Tab:**
   - Similar upload and grid structure
   - Template cards include building/floor metadata
   - Assign template to buildings via modal dialog

3. **Unit Mapping Tab:**
   - Left panel (60%): Large canvas with loaded floor plan SVG
   - Right sidebar (40%): Tool palette, polygon list, unit assignment form
   - Bottom status bar showing coordinates and canvas zoom level

**Header:** Page title "Floor Plan Manager" with "Upload New Map" button (teal, prominent)

**No Hero Image:** This is a functional admin interface—focus on tool accessibility and workspace efficiency, not visual storytelling.