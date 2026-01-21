const Booking = require("../models/booking.model");

/**
 * Parse distance string (e.g. "123", "123.4", "123 km") to a number.
 * Returns NaN if cannot be parsed.
 */
const parseDistanceToNumber = (distance) => {
  if (distance === null || distance === undefined) return NaN;
  if (typeof distance === "number") return distance;
  if (typeof distance !== "string") return NaN;

  const match = distance.match(/[\d.]+/);
  if (!match) return NaN;
  return parseFloat(match[0]);
};

/**
 * Returns the single active booking for a driver, if any.
 * "Active" here means any booking that has been started but not completed.
 */
const findActiveBookingForDriver = async (driverId) => {
  if (!driverId) return null;
  return Booking.findOne({
    driverId,
    status: { $in: ["started", "picked_up", "dropped_off"] },
  });
};

/**
 * Throws an error if driver already has an active booking.
 */
const assertDriverHasNoActiveBooking = async (driverId) => {
  const activeBooking = await findActiveBookingForDriver(driverId);
  if (activeBooking) {
    const err = new Error(
      "Driver already has an active booking and cannot start another."
    );
    err.statusCode = 400;
    err.code = "DRIVER_ACTIVE_BOOKING_EXISTS";
    err.meta = { bookingId: activeBooking._id.toString() };
    throw err;
  }
};

/**
 * Normalize vehicle type/cat_title from Dutch/English to standard English vehicle types.
 * Maps all possible variations to the standard backend vehicle types: "Standard", "Luxury", "Taxi Bus"
 * 
 * @param {string} catTitle - The cat_title from booking (can be in Dutch or English)
 * @returns {string} Normalized vehicle type ("Standard", "Luxury", or "Taxi Bus")
 */
const normalizeVehicleType = (catTitle) => {
  if (!catTitle || typeof catTitle !== "string") return null;
  
  // Normalize to lowercase for case-insensitive matching
  const normalized = catTitle.trim().toLowerCase();
  
  // Map Dutch and English variations to standard backend types
  const mapping = {
    // Standard variations
    "standaard": "Standard",
    "standard": "Standard",
    
    // Luxury/Luxe variations
    "luxe": "Luxury",
    "luxury": "Luxury",
    
    // Taxi Bus variations (usually same in both languages)
    "taxi bus": "Taxi Bus",
    "taxibus": "Taxi Bus",
    "taxi-bus": "Taxi Bus",
  };
  
  return mapping[normalized] || null;
};

/**
 * Get all possible cat_title variations for a given standard vehicle type.
 * Used to build MongoDB queries that match both Dutch and English cat_title values.
 * 
 * @param {string|Array<string>} vehicleTypes - Standard vehicle type(s): "Standard", "Luxury", "Taxi Bus"
 * @returns {Array<string>} Array of all possible cat_title variations (Dutch + English)
 */
const getCatTitleVariations = (vehicleTypes) => {
  const types = Array.isArray(vehicleTypes) ? vehicleTypes : [vehicleTypes];
  const variations = [];
  
  // Map each standard type to its possible variations
  const typeVariations = {
    "Standard": ["Standard", "Standaard"],
    "Luxury": ["Luxury", "Luxe"],
    "Taxi Bus": ["Taxi Bus", "Taxibus", "Taxi-Bus"],
  };
  
  types.forEach(type => {
    if (typeVariations[type]) {
      variations.push(...typeVariations[type]);
    } else {
      // If type is not recognized, include it as-is
      variations.push(type);
    }
  });
  
  return [...new Set(variations)]; // Remove duplicates
};

/**
 * Get vehicle types that should match a booking's cat_title.
 * Business rule: Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles.
 * Taxi Bus bookings can only be handled by Taxi Bus vehicles.
 * 
 * @param {string} bookingCatTitle - Booking's cat_title (can be in Dutch or English)
 * @returns {Array<string>} Array of vehicle types that should match this booking: ["Standard", "Luxury"] or ["Taxi Bus"]
 */
const getVehicleTypesForBooking = (bookingCatTitle) => {
  if (!bookingCatTitle || typeof bookingCatTitle !== "string") {
    return [];
  }

  // Normalize to lowercase for case-insensitive matching
  const normalized = bookingCatTitle.trim().toLowerCase();
  
  // Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
  if (normalized === "standard" || normalized === "standaard" || 
      normalized === "luxury" || normalized === "luxe") {
    return ["Standard", "Luxury"];
  }
  
  // Taxi Bus bookings can only be handled by Taxi Bus vehicles
  if (normalized === "taxi bus" || normalized === "taxibus" || normalized === "taxi-bus") {
    return ["Taxi Bus"];
  }
  
  // Fallback: if unknown, return empty array
  return [];
};

module.exports = {
  parseDistanceToNumber,
  findActiveBookingForDriver,
  assertDriverHasNoActiveBooking,
  normalizeVehicleType,
  getCatTitleVariations,
  getVehicleTypesForBooking,
};


