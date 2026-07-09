/**
 * Consolidated Data Import Field Registry
 *
 * Single source of truth for every dataset type the platform can import.
 * Drives: template export (.xlsx/.csv), manual import validation,
 * scheduled SFTP imports, and the registry viewer UI.
 */

export type FieldType = "string" | "number" | "integer" | "boolean" | "date" | "month" | "enum" | "percent";

export interface RegistryField {
  /** camelCase internal field name (matches DB column mapping target) */
  key: string;
  /** Human-readable column header used in templates */
  label: string;
  type: FieldType;
  required: boolean;
  /** Expected format hint, e.g. "YYYY-MM" */
  format?: string;
  /** Allowed values for enum type */
  allowedValues?: string[];
  description: string;
  /** Sample value shown in template sample row */
  sample: string;
  /** Common header aliases accepted during import (case-insensitive) */
  aliases?: string[];
}

export interface DatasetDefinition {
  /** dataset type id */
  id: string;
  name: string;
  description: string;
  /** DB table the data lands in */
  targetTable: string;
  /** field key that carries the period (YYYY-MM) if present in file */
  periodField: string | null;
  /** regex applied to filename to extract period, e.g. rentroll_2026-06.csv */
  filenamePeriodPattern: string;
  /** Whether import replaces the whole period (true) or appends (false) */
  replacesPeriod: boolean;
  fields: RegistryField[];
}

const MONTH_FORMAT = "YYYY-MM";
const SERVICE_LINES = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];
const RATINGS = ["A", "B", "C"];

export const IMPORT_DATASETS: DatasetDefinition[] = [
  {
    id: "rent_roll",
    name: "Rent Roll",
    description: "Unit-level occupancy and rate data. One row per unit per month. Importing a month replaces all existing data for that month.",
    targetTable: "rent_roll_data",
    periodField: "uploadMonth",
    filenamePeriodPattern: "(20\\d{2})[-_]?(0[1-9]|1[0-2])",
    replacesPeriod: true,
    fields: [
      { key: "uploadMonth", label: "Upload Month", type: "month", required: true, format: MONTH_FORMAT, description: "Reporting period the data belongs to", sample: "2026-06", aliases: ["Month", "Period", "Report Month", "Upload_Month"] },
      { key: "date", label: "Date", type: "date", required: true, format: "YYYY-MM-DD", description: "As-of date of the snapshot", sample: "2026-06-30", aliases: ["As Of Date", "Report Date"] },
      { key: "location", label: "Location", type: "string", required: true, description: "Campus / community name (must match a known location)", sample: "Maple Grove Senior Living", aliases: ["Campus", "Facility", "Community", "Property"] },
      { key: "roomNumber", label: "Room Number", type: "string", required: true, description: "Unit identifier, unique within a location", sample: "204A", aliases: ["Unit", "Unit ID", "Room", "Room #", "Apartment"] },
      { key: "roomType", label: "Room Type", type: "string", required: true, description: "Raw room type; normalized to Studio / Studio Dlx / One Bedroom / Two Bedroom / Companion", sample: "One Bedroom", aliases: ["Unit Type", "Type", "Bed Type"] },
      { key: "serviceLine", label: "Service Line", type: "enum", required: true, allowedValues: SERVICE_LINES, description: "Care service line", sample: "AL", aliases: ["Level of Care", "Care Type", "LOC"] },
      { key: "occupiedYN", label: "Occupied Y/N", type: "boolean", required: true, description: "Whether the unit is occupied (Y/N, TRUE/FALSE, 1/0)", sample: "Y", aliases: ["Occupied", "Is Occupied", "Occupancy", "Status"] },
      { key: "size", label: "Size", type: "string", required: true, description: "Unit size descriptor", sample: "One Bedroom", aliases: ["Unit Size", "Sq Ft", "Bedrooms"] },
      { key: "streetRate", label: "Street Rate", type: "number", required: true, description: "Published market rate. HC & HC/MC are daily; AL, AL/MC, SL, VIL are monthly.", sample: "4850", aliases: ["Base Rent", "Market Rate", "List Rate", "Asking Rate"] },
      { key: "inHouseRate", label: "In-House Rate", type: "number", required: true, description: "Actual rate paid by current resident (same daily/monthly convention as Street Rate)", sample: "4600", aliases: ["Current Rate", "Actual Rate", "Resident Rate"] },
      { key: "daysVacant", label: "Days Vacant", type: "integer", required: false, description: "Consecutive days the unit has been vacant", sample: "12", aliases: ["Vacant Days", "Days Empty"] },
      { key: "view", label: "View", type: "string", required: false, description: "View descriptor (Garden View, Courtyard View, ...)", sample: "Garden View" },
      { key: "renovated", label: "Renovated", type: "boolean", required: false, description: "Whether the unit has been renovated", sample: "N" },
      { key: "preferredLocation", label: "Preferred Location", type: "string", required: false, description: "Premium location flag/descriptor", sample: "Near Dining" },
      { key: "otherPremiumFeature", label: "Other Premium Feature", type: "string", required: false, description: "Additional premium feature notes", sample: "Balcony" },
      { key: "locationRating", label: "Location Rating", type: "enum", required: false, allowedValues: RATINGS, description: "A/B/C rating for unit location within building", sample: "A" },
      { key: "sizeRating", label: "Size Rating", type: "enum", required: false, allowedValues: RATINGS, description: "A/B/C rating for unit size", sample: "B" },
      { key: "viewRating", label: "View Rating", type: "enum", required: false, allowedValues: RATINGS, description: "A/B/C rating for view quality", sample: "A" },
      { key: "renovationRating", label: "Renovation Rating", type: "enum", required: false, allowedValues: RATINGS, description: "A/B/C rating for renovation state", sample: "C" },
      { key: "amenityRating", label: "Amenity Rating", type: "enum", required: false, allowedValues: RATINGS, description: "A/B/C rating for amenities", sample: "B" },
      { key: "careLevel", label: "Care Level", type: "string", required: false, description: "Resident care level", sample: "2" },
      { key: "careRate", label: "Care Rate", type: "number", required: false, description: "Monthly care charge", sample: "1200" },
      { key: "rentAndCareRate", label: "Rent and Care Rate", type: "number", required: false, description: "Combined rent + care rate", sample: "5800" },
      { key: "promotionAllowance", label: "Promotion Allowance", type: "number", required: false, description: "Promotional discount amount", sample: "500" },
      { key: "residentId", label: "Resident ID", type: "string", required: false, description: "Unique resident identifier", sample: "R-10422" },
      { key: "residentName", label: "Resident Name", type: "string", required: false, description: "Resident full name", sample: "Jane Doe" },
      { key: "moveInDate", label: "Move-In Date", type: "date", required: false, format: "YYYY-MM-DD", description: "Resident move-in date", sample: "2025-11-04" },
      { key: "moveOutDate", label: "Move-Out Date", type: "date", required: false, format: "YYYY-MM-DD", description: "Resident move-out date if applicable", sample: "" },
      { key: "payorType", label: "Payor Type", type: "string", required: false, description: "Private Pay, Medicaid, Medicare, Insurance", sample: "Private Pay" },
    ],
  },
  {
    id: "competitive_survey",
    name: "Competitive Survey",
    description: "Competitor rate survey rows keyed to your campuses. Importing a survey month replaces existing survey data for that month.",
    targetTable: "competitive_survey_data",
    periodField: "surveyMonth",
    filenamePeriodPattern: "(20\\d{2})[-_]?(0[1-9]|1[0-2])",
    replacesPeriod: true,
    fields: [
      { key: "surveyMonth", label: "Survey Month", type: "month", required: true, format: MONTH_FORMAT, description: "Month the survey was conducted", sample: "2026-06", aliases: ["Month", "Period"] },
      { key: "keyStatsLocation", label: "KeyStats Location", type: "string", required: true, description: "Your campus name the competitor is benchmarked against", sample: "Maple Grove Senior Living", aliases: ["Location", "Campus"] },
      { key: "competitorName", label: "Competitor Name", type: "string", required: true, description: "Competitor community name", sample: "Sunrise of Oakdale" },
      { key: "competitorAddress", label: "Competitor Address", type: "string", required: false, description: "Street address of competitor", sample: "123 Main St, Oakdale, MN" },
      { key: "distanceMiles", label: "Distance (Miles)", type: "number", required: false, description: "Distance from your campus in miles", sample: "3.4" },
      { key: "competitorType", label: "Competitor Type", type: "string", required: false, description: "IL, AL, MC, SNF", sample: "AL" },
      { key: "roomType", label: "Room Type", type: "string", required: false, description: "Room type surveyed (Studio, 1BR, 2BR)", sample: "1BR" },
      { key: "squareFootage", label: "Square Footage", type: "integer", required: false, description: "Unit square footage", sample: "620" },
      { key: "monthlyRateLow", label: "Monthly Rate Low", type: "number", required: false, description: "Low end of monthly base rate", sample: "4200" },
      { key: "monthlyRateHigh", label: "Monthly Rate High", type: "number", required: false, description: "High end of monthly base rate", sample: "5400" },
      { key: "monthlyRateAvg", label: "Monthly Rate Avg", type: "number", required: false, description: "Average monthly base rate", sample: "4800" },
      { key: "careLevel1Rate", label: "Care Level 1 Rate", type: "number", required: false, description: "Monthly care fee at level 1", sample: "600" },
      { key: "careLevel2Rate", label: "Care Level 2 Rate", type: "number", required: false, description: "Monthly care fee at level 2", sample: "1100" },
      { key: "careLevel3Rate", label: "Care Level 3 Rate", type: "number", required: false, description: "Monthly care fee at level 3", sample: "1650" },
      { key: "careLevel4Rate", label: "Care Level 4 Rate", type: "number", required: false, description: "Monthly care fee at level 4", sample: "2200" },
      { key: "medicationManagementFee", label: "Medication Management Fee", type: "number", required: false, description: "Monthly med management fee", sample: "450" },
      { key: "communityFee", label: "Community Fee", type: "number", required: false, description: "One-time community fee", sample: "3000" },
      { key: "petFee", label: "Pet Fee", type: "number", required: false, description: "Pet fee", sample: "500" },
      { key: "incentives", label: "Incentives", type: "string", required: false, description: "Current move-in incentives", sample: "1 month free" },
      { key: "totalUnits", label: "Total Units", type: "integer", required: false, description: "Total unit count at competitor", sample: "88" },
      { key: "occupancyRate", label: "Occupancy Rate", type: "percent", required: false, description: "Occupancy as a percentage (0-100)", sample: "92" },
      { key: "yearBuilt", label: "Year Built", type: "integer", required: false, description: "Year the community was built", sample: "2008" },
      { key: "notes", label: "Notes", type: "string", required: false, description: "Free-form survey notes", sample: "Renovating memory care wing" },
    ],
  },
  {
    id: "inquiry",
    name: "Inquiry Metrics",
    description: "Aggregated inquiry/tour/conversion counts by location, service line and lead source. Importing a month replaces existing inquiry data for that month.",
    targetTable: "inquiry_metrics",
    periodField: "uploadMonth",
    filenamePeriodPattern: "(20\\d{2})[-_]?(0[1-9]|1[0-2])",
    replacesPeriod: true,
    fields: [
      { key: "uploadMonth", label: "Upload Month", type: "month", required: true, format: MONTH_FORMAT, description: "Reporting period", sample: "2026-06", aliases: ["Month", "Period"] },
      { key: "date", label: "Date", type: "date", required: true, format: "YYYY-MM-DD", description: "As-of date", sample: "2026-06-30" },
      { key: "location", label: "Location", type: "string", required: true, description: "Campus name", sample: "Maple Grove Senior Living", aliases: ["Campus", "Facility", "Community"] },
      { key: "region", label: "Region", type: "string", required: false, description: "Region name", sample: "Midwest" },
      { key: "division", label: "Division", type: "string", required: false, description: "Division name", sample: "North" },
      { key: "serviceLine", label: "Service Line", type: "enum", required: false, allowedValues: SERVICE_LINES, description: "Care service line", sample: "AL" },
      { key: "leadSource", label: "Lead Source", type: "string", required: false, description: "Where the inquiry came from", sample: "A Place for Mom" },
      { key: "inquiryCount", label: "Inquiry Count", type: "integer", required: true, description: "Number of inquiries in the period", sample: "34" },
      { key: "tourCount", label: "Tour Count", type: "integer", required: false, description: "Number of tours in the period", sample: "18" },
      { key: "conversionCount", label: "Conversion Count", type: "integer", required: false, description: "Number of move-ins from inquiries", sample: "6" },
      { key: "conversionRate", label: "Conversion Rate", type: "percent", required: false, description: "Conversion rate percentage (0-100)", sample: "17.6" },
      { key: "daysToTour", label: "Days to Tour", type: "integer", required: false, description: "Average days from inquiry to tour", sample: "5" },
      { key: "daysToMoveIn", label: "Days to Move-In", type: "integer", required: false, description: "Average days from inquiry to move-in", sample: "21" },
    ],
  },
  {
    id: "room_type_occupancy",
    name: "Room Type Occupancy",
    description: "Monthly occupancy by location, service line and room type (T3M source). Importing a month replaces existing occupancy rows for that month.",
    targetTable: "room_type_occupancy_history",
    periodField: "month",
    filenamePeriodPattern: "(20\\d{2})[-_]?(0[1-9]|1[0-2])",
    replacesPeriod: true,
    fields: [
      { key: "month", label: "Month", type: "month", required: true, format: MONTH_FORMAT, description: "Reporting period (YYYY-MM; split into year and month numbers on import)", sample: "2026-06", aliases: ["Period", "Upload Month"] },
      { key: "locationName", label: "Location Name", type: "string", required: true, description: "Campus name", sample: "Maple Grove Senior Living", aliases: ["Location", "Campus", "Facility"] },
      { key: "division", label: "Division", type: "string", required: false, description: "Division name", sample: "North" },
      { key: "serviceLine", label: "Service Line", type: "string", required: true, description: "Care service line (composite values like \"AL, MC\" allowed)", sample: "AL" },
      { key: "rawRoomType", label: "Room Type", type: "string", required: true, description: "Raw room type; normalized on import", sample: "Studio Deluxe", aliases: ["Room Type", "Unit Type"] },
      { key: "occUnits", label: "Occupied Units", type: "number", required: true, description: "Average occupied units in the month", sample: "14.5", aliases: ["Occ Units", "Occupied"] },
      { key: "availableUnits", label: "Available Units", type: "integer", required: true, description: "Total available units", sample: "16", aliases: ["Available", "Total Units"] },
      { key: "occPercent", label: "Occupancy %", type: "percent", required: false, description: "Occupancy percentage (0-100); computed if omitted", sample: "90.6" },
    ],
  },
];

export function getDataset(id: string): DatasetDefinition | undefined {
  return IMPORT_DATASETS.find((d) => d.id === id);
}

export const DATASET_IDS = IMPORT_DATASETS.map((d) => d.id);
