/**
 * Room Type Standardization System
 * Normalizes all room type variations to exactly 5 standard values:
 * - Studio
 * - Studio Dlx
 * - One Bedroom
 * - Two Bedroom
 * - Companion
 */

// Standard room types (the only allowed values)
export const STANDARD_ROOM_TYPES = {
  STUDIO: 'Studio',
  STUDIO_DLX: 'Studio Dlx',
  ONE_BEDROOM: 'One Bedroom',
  TWO_BEDROOM: 'Two Bedroom',
  COMPANION: 'Companion'
} as const;

export type StandardRoomType = typeof STANDARD_ROOM_TYPES[keyof typeof STANDARD_ROOM_TYPES];

/**
 * Normalizes a raw room type string to one of the 5 standard room types
 * @param rawRoomType - The raw room type string from data import or user input
 * @returns One of the 5 standard room types, or 'Studio' as default
 */
export function normalizeRoomType(rawRoomType: string | null | undefined): StandardRoomType {
  // Handle null/undefined/empty inputs
  if (!rawRoomType || rawRoomType.trim() === '') {
    console.warn('Empty or null room type provided, defaulting to Studio');
    return STANDARD_ROOM_TYPES.STUDIO;
  }

  // Convert to lowercase for case-insensitive matching and trim whitespace
  const normalized = rawRoomType.toLowerCase().trim();

  // Companion room mappings (shared/double occupancy)
  const companionKeywords = [
    'companion',
    'double',
    'shared',
    'mc companion',
    'memory care companion',
    'al companion',
    'semi-private',
    'semi private',
    'semiprivate',
    'double occupancy',
    'shared room',
    'roommate',
    'companion suite',
    'companion room',
    'double room'
  ];

  // Studio Deluxe mappings (premium/larger studios)
  const studioDeluxeKeywords = [
    'studio deluxe',
    'studio dlx',
    'studio premium',
    'premium studio',
    'studio plus',
    'studio+',
    'deluxe studio',
    'dlx studio',
    'studio - deluxe',
    'studio - premium',
    'studio - private',
    'private deluxe',
    'private studio deluxe',
    'studio with kitchenette',
    'studio w/ kitchenette',
    'enhanced studio',
    'superior studio',
    'studio suite',
    'large studio',
    'studio xl',
    'studio large'
  ];

  // Regular Studio mappings
  const studioKeywords = [
    'studio',
    'efficiency',
    'eff',
    'private',
    'private room',
    'single',
    'single room',
    'bachelor',
    'alcove',
    'jr studio',
    'junior studio',
    'micro',
    'standard studio',
    'basic studio',
    'classic studio'
  ];

  // One Bedroom mappings
  const oneBedroomKeywords = [
    '1 bedroom',
    'one bedroom',
    '1 bed',
    '1br',
    '1-bedroom',
    '1 br',
    '1-br',
    'one bed',
    'one-bedroom',
    'one br',
    'single bedroom',
    '1 bdrm',
    '1bdrm',
    'one bdrm',
    'villa',
    'independent living',
    'il',
    'apartment',
    'unit',
    'suite',
    '1 room suite',
    'junior 1 bedroom',
    'jr 1 bedroom',
    'small 1 bedroom'
  ];

  // Two Bedroom mappings
  const twoBedroomKeywords = [
    '2 bedroom',
    'two bedroom',
    '2 bed',
    '2br',
    '2-bedroom',
    '2 br',
    '2-br',
    'two bed',
    'two-bedroom',
    'two br',
    'double bedroom',
    '2 bdrm',
    '2bdrm',
    'two bdrm',
    '3 bedroom',
    'three bedroom',
    '3 bed',
    '3br',
    '3-bedroom',
    'multi bedroom',
    'multi-bedroom',
    'family suite',
    'large apartment',
    '2 room suite',
    'deluxe suite',
    'penthouse'
  ];

  // Check for companion/shared rooms first (highest priority)
  for (const keyword of companionKeywords) {
    if (normalized.includes(keyword)) {
      return STANDARD_ROOM_TYPES.COMPANION;
    }
  }

  // Check for Studio Deluxe (before regular studio to catch premium variations)
  for (const keyword of studioDeluxeKeywords) {
    if (normalized.includes(keyword)) {
      return STANDARD_ROOM_TYPES.STUDIO_DLX;
    }
  }

  // Check for Two Bedroom (before One Bedroom to catch "2" before "1")
  for (const keyword of twoBedroomKeywords) {
    if (normalized.includes(keyword)) {
      return STANDARD_ROOM_TYPES.TWO_BEDROOM;
    }
  }

  // Check for One Bedroom
  for (const keyword of oneBedroomKeywords) {
    if (normalized.includes(keyword)) {
      return STANDARD_ROOM_TYPES.ONE_BEDROOM;
    }
  }

  // Check for regular Studio
  for (const keyword of studioKeywords) {
    if (normalized.includes(keyword)) {
      return STANDARD_ROOM_TYPES.STUDIO;
    }
  }

  // Log unmapped room types to help catch edge cases
  console.warn(`Unmapped room type: "${rawRoomType}" - defaulting to Studio`);
  
  // Default to Studio if no match found
  return STANDARD_ROOM_TYPES.STUDIO;
}

/**
 * Validates if a room type is one of the standard types
 */
export function isStandardRoomType(roomType: string): roomType is StandardRoomType {
  return Object.values(STANDARD_ROOM_TYPES).includes(roomType as StandardRoomType);
}

/**
 * Gets all standard room types as an array
 */
export function getAllStandardRoomTypes(): StandardRoomType[] {
  return Object.values(STANDARD_ROOM_TYPES);
}