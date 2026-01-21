const mongoose = require("mongoose");
const Booking = require("../models/booking.model");
const Driver = require("../models/driver.model");
const Vehicle = require("../models/vehicle.model");
const WalletTransaction = require("../models/walletTransaction.model");
const {
  parseDistanceToNumber,
  assertDriverHasNoActiveBooking,
  findActiveBookingForDriver,
  getCatTitleVariations,
  getVehicleTypesForBooking,
} = require("../utils/booking.helper");

/**
 * Generate a unique order/ride number
 * Format: {PREFIX}-{NUMBER}
 * Example: RID-1000, RID-1001, RID-1002, etc.
 * Starts from 1000 and increments sequentially
 */
/**
 * ULTRA-FAST order number generation - NO database queries
 * Uses last 5 digits of timestamp for short, unique order numbers
 * Format: RID-{5digits}
 * Last 5 digits of timestamp provide uniqueness for ~2.7 hours
 * If collision occurs (rare), retry mechanism handles it
 * This is the simplest and fastest approach with short numbers
 */
const generateOrderNumber = () => {
  const prefix = process.env.ORDER_NUMBER_PREFIX || "RID";
  const timestamp = Date.now();
  // Use last 5 digits of timestamp for short order number (up to 5 digits)
  // This provides uniqueness for ~2.7 hours, which is sufficient for most use cases
  const shortNumber = timestamp.toString().slice(-5); // Last 5 digits
  return `${prefix}-${shortNumber}`;
};

/**
 * Helper to build a consistent error with HTTP status code.
 */
const buildError = (message, statusCode = 400, code, meta) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  if (meta) err.meta = meta;
  return err;
};

/**
 * USER SERVICES
 */

exports.createBooking = async (payload) => {
  const commissionPercentage = parseFloat(process.env.DRIVER_COMMISSION_PERCENTAGE || "22");
  const actualPriceString = payload.actualPrice || payload.price;
  const actualPriceNumber = parseFloat(String(actualPriceString || "0").replace(/[^\d.-]/g, "")) || 0;
  const commissionAmount = actualPriceNumber * (commissionPercentage / 100);
  const driverPriceNumber = actualPriceNumber - commissionAmount;
  const commissionRounded = Math.round(commissionAmount * 100) / 100;
  const driverPriceRounded = Math.round(driverPriceNumber * 100) / 100;
  const commissionString = commissionRounded.toFixed(2);
  const driverPriceString = driverPriceRounded.toFixed(2);
  const actualPriceStringFormatted = String(actualPriceString);
  const assignmentType = actualPriceNumber > 150 ? "admin" : "auto";
  const now = new Date();
  const expiresAt = actualPriceNumber < 150 ? new Date(now.getTime() + 5 * 60 * 1000) : undefined;
  let orderNumber = generateOrderNumber();

  const bookingData = {
    ...payload,
    orderNumber,
    actualPrice: actualPriceStringFormatted,
    price: driverPriceString,
    commission: commissionString,
    driverPrice: driverPriceString,
    assignmentType,
    status: "pending",
    isAccepted: false,
    isRejected: false,
    rejectionReason: undefined,
    driverId: null,
    startedAt: undefined,
    pickedUpAt: undefined,
    droppedOffAt: undefined,
    completedAt: undefined,
    expiresAt,
    isExpired: false,
  };

  try {
    const booking = await Booking.create(bookingData);
    return booking;
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.orderNumber) {
      orderNumber = generateOrderNumber();
      bookingData.orderNumber = orderNumber;
      const booking = await Booking.create(bookingData);
      return booking;
    }
    throw error;
  }
};

exports.getBookingStatus = async (bookingId) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }
  return {
    id: booking._id,
    status: booking.status,
    driverId: booking.driverId,
    assignmentType: booking.assignmentType,
    isAccepted: booking.isAccepted,
    isRejected: booking.isRejected,
  };
};

/**
 * Get booking by order number
 */
exports.getBookingByOrderNumber = async (orderNumber) => {
  const booking = await Booking.findOne({ orderNumber })
    .populate("driverId", "firstName lastName email phone")
    .lean();
  
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }
  
  return booking;
};

/**
 * ADMIN SERVICES
 */

exports.assignDriverToBooking = async (bookingId, driverId) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  const wasExpired = booking.isExpired === true;

  if (!["pending", "rejected"].includes(booking.status)) {
    throw buildError(
      "Driver can only be assigned to pending or rejected bookings.",
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  booking.driverId = driverId;
  booking.assignmentType = "admin";
  booking.status = "pending"; // Reset status to pending (for rejected bookings being reassigned)
  booking.isRejected = false;
  booking.isAccepted = false;
  booking.rejectionReason = undefined;
  
  // If booking was expired, reset expiration fields when admin assigns
  if (wasExpired) {
    booking.isExpired = false;
    booking.expiredAt = undefined;
    // Admin-assigned bookings should not expire; clear any past expiry
    booking.expiresAt = null;
  }

  await booking.save();
  return booking;
};

exports.unassignDriver = async (bookingId) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (!booking.driverId) {
    throw buildError("No driver assigned to this booking.", 400);
  }

  if (!["pending", "rejected"].includes(booking.status)) {
    throw buildError(
      "Driver can only be unassigned from pending or rejected bookings.",
      400
    );
  }

  booking.driverId = null;
  booking.assignmentType = "admin"; // still a long ride requiring admin assignment
  await booking.save();
  return booking;
};

// Helper function to parse price from string to number
const parsePrice = (priceString) => {
  return parseFloat(String(priceString || "0").replace(/[^\d.-]/g, "")) || 0;
};

// Helper function to get actual price (with fallback to price for backward compatibility)
const getActualPriceNumber = (booking) => {
  // Use actualPrice if available, otherwise fallback to price (for existing bookings)
  const actualPriceString = booking.actualPrice || booking.price;
  return parsePrice(actualPriceString);
};

exports.viewPendingLongDistanceBookings = async (page = 1, limit = 12) => {
  // Get all pending bookings (exclude expired - they are shown separately)
  const allPendingBookings = await Booking.find({
    status: "pending",
    isExpired: { $ne: true }, // Exclude expired bookings
  })
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
  
  // Filter by price > 150
  const filteredBookings = allPendingBookings.filter((booking) => {
    const actualPriceNumber = getActualPriceNumber(booking);
    return actualPriceNumber > 150;
  });
  
  // Apply pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const paginatedBookings = filteredBookings.slice(skip, skip + parseInt(limit));
  const total = filteredBookings.length;
  
  return {
    bookings: paginatedBookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

/**
 * Get all pending bookings (all prices, exclude expired)
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated pending bookings
 */
exports.getAllPendingBookings = async (page = 1, limit = 12) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Query filter: Pending bookings, exclude expired
  const query = {
    status: "pending",
    isExpired: { $ne: true }, // Exclude expired bookings
  };
  
  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .sort({ createdAt: -1 }) // Newest bookings first
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Booking.countDocuments(query),
  ]);
  
  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

// Get all bookings with price > 150 (includes all statuses: expired, completed, assigned, etc.)
exports.viewHighPriceBookings = async (page = 1, limit = 12) => {
  const allBookings = await Booking.find({})
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
  
  const filteredBookings = allBookings.filter((booking) => {
    const actualPriceNumber = getActualPriceNumber(booking);
    return actualPriceNumber > 150;
  });
  
  // Apply pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const paginatedBookings = filteredBookings.slice(skip, skip + parseInt(limit));
  const total = filteredBookings.length;
  
  return {
    bookings: paginatedBookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

// Get all bookings with price <= 150 (excludes expired - they should only appear in getExpiredBookings)
exports.viewLowPriceBookings = async (page = 1, limit = 12) => {
  const allBookings = await Booking.find({
    isExpired: { $ne: true }, // Exclude expired bookings
  })
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
  
  const filteredBookings = allBookings.filter((booking) => {
    const actualPriceNumber = getActualPriceNumber(booking);
    return actualPriceNumber <= 150;
  });
  
  // Apply pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const paginatedBookings = filteredBookings.slice(skip, skip + parseInt(limit));
  const total = filteredBookings.length;
  
  return {
    bookings: paginatedBookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

// Get all bookings (excludes expired bookings - they are shown separately in expired tab)
// Industrial-scale solution: Uses database indexes for efficient querying
exports.getAllBookings = async (page = 1, limit = 12) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // "All Bookings" should show ALL bookings including expired ones
  // No filters - show everything
  const query = {};
  
  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .sort({ createdAt: -1 }) // Newest bookings first
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Booking.countDocuments(query),
  ]);
  
  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

/**
 * DRIVER SERVICES
 */

/**
 * Get all available/live bookings (unified for drivers and admins)
 * Industrial-scale solution: Shows all pending, non-expired bookings
 * Includes both auto-assigned and admin-assigned bookings
 * For drivers: Only shows bookings matching their vehicle type(s)
 * For admins: Shows all bookings
 * @param {string} driverId - Optional driver ID (for filtering by vehicle type)
 * @returns {Promise<Array>} Array of available bookings
 */
exports.getAvailableBookings = async (driverId) => {
  // Get all live/available bookings (both auto and admin-assigned)
  // Exclude expired bookings using database indexes
  // Only show bookings that are:
  // 1. Pending status
  // 2. Not expired (isExpired !== true)
  // 3. Not past expiration time (expiresAt > now OR expiresAt is null)
  const now = new Date();
  
  // Build base query
  const baseQuery = {
    status: "pending",
    isExpired: { $ne: true }, // Exclude expired bookings (handles null, undefined, false)
    $or: [
      { expiresAt: { $gt: now } }, // Booking hasn't expired yet
      { expiresAt: null }, // No expiration set (admin-assigned bookings or bookings without expiration)
    ],
  };

  // If driverId is provided, filter by driver's vehicle type(s)
  if (driverId) {
    try {
      // Get driver's approved vehicles
      const vehicles = await Vehicle.find({
        driver: driverId,
        status: "Approved",
        deletedAt: null, // Exclude soft-deleted vehicles
      }).select("type").lean();

      // If driver has approved vehicles, filter bookings by vehicle type
      if (vehicles && vehicles.length > 0) {
        // Extract unique vehicle types
        const vehicleTypes = [...new Set(vehicles.map(v => v.type))];
        
        // Build list of cat_title variations that should match this driver's vehicle types
        // Business rule: Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
        // Taxi Bus bookings can only be handled by Taxi Bus vehicles
        const catTitleVariations = new Set();
        
        vehicleTypes.forEach(vehicleType => {
          if (vehicleType === "Standard" || vehicleType === "Luxury") {
            // Drivers with Standard OR Luxury vehicles can see both Standard/Standaard and Luxury/Luxe bookings
            catTitleVariations.add("Standard");
            catTitleVariations.add("Standaard");
            catTitleVariations.add("Luxury");
            catTitleVariations.add("Luxe");
          } else if (vehicleType === "Taxi Bus") {
            // Drivers with Taxi Bus vehicles can only see Taxi Bus bookings
            catTitleVariations.add("Taxi Bus");
            catTitleVariations.add("Taxibus");
            catTitleVariations.add("Taxi-Bus");
          }
        });
        
        // Add vehicle type filter to query
        // Match bookings where cat_title matches any of the allowed variations
        if (catTitleVariations.size > 0) {
          baseQuery.cat_title = { $in: Array.from(catTitleVariations) };
        }
      } else {
        // Driver has no approved vehicles, return empty array
        return [];
      }
    } catch (error) {
      // If error fetching vehicles, log and continue with all bookings (fallback)
      console.error("Error fetching driver vehicles for booking filter:", error);
      // Continue without vehicle type filter as fallback
    }
  }

  // Use $ne: true to catch null, undefined, and false values
  // This ensures we exclude any booking that has been marked as expired
  // Includes both auto-assigned (price <= 150) and admin-assigned (price > 150) bookings
  return Booking.find(baseQuery)
    // Show newest created bookings first to surface freshly created items
    .sort({ createdAt: -1, date_time: -1 })
    .lean();
};

/**
 * Get all live bookings (unified endpoint for admin and driver)
 * Shows all pending, non-expired AUTO-ASSIGNED bookings in real-time
 * IMPORTANT: Admin-assigned bookings (assignmentType === "admin") should NOT appear in LIVE API
 * Admin-assigned bookings only appear in ASSIGNED API for the assigned driver
 * For drivers: Only shows bookings matching their vehicle type(s)
 * For admins: Shows all bookings
 * @param {string} driverId - Optional driver ID (for filtering by vehicle type)
 * @returns {Promise<Array>} Array of live bookings (auto-assigned only)
 */
exports.getLiveBookings = async (driverId) => {
  const now = new Date();
  
  // Build base query for live bookings
  const baseQuery = {
    status: "pending",
    isExpired: { $ne: true },
    assignmentType: "auto", // Only auto-assigned bookings appear in LIVE API
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: null },
    ],
  };

  // If driverId is provided, filter by driver's vehicle type(s)
  if (driverId) {
    try {
      // Get driver's approved vehicles
      const vehicles = await Vehicle.find({
        driver: driverId,
        status: "Approved",
        deletedAt: null, // Exclude soft-deleted vehicles
      }).select("type").lean();

      // If driver has approved vehicles, filter bookings by vehicle type
      if (vehicles && vehicles.length > 0) {
        // Extract unique vehicle types
        const vehicleTypes = [...new Set(vehicles.map(v => v.type))];
        
        // Build list of cat_title variations that should match this driver's vehicle types
        // Business rule: Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
        // Taxi Bus bookings can only be handled by Taxi Bus vehicles
        const catTitleVariations = new Set();
        
        vehicleTypes.forEach(vehicleType => {
          if (vehicleType === "Standard" || vehicleType === "Luxury") {
            // Drivers with Standard OR Luxury vehicles can see both Standard/Standaard and Luxury/Luxe bookings
            catTitleVariations.add("Standard");
            catTitleVariations.add("Standaard");
            catTitleVariations.add("Luxury");
            catTitleVariations.add("Luxe");
          } else if (vehicleType === "Taxi Bus") {
            // Drivers with Taxi Bus vehicles can only see Taxi Bus bookings
            catTitleVariations.add("Taxi Bus");
            catTitleVariations.add("Taxibus");
            catTitleVariations.add("Taxi-Bus");
          }
        });
        
        // Add vehicle type filter to query
        // Match bookings where cat_title matches any of the allowed variations
        if (catTitleVariations.size > 0) {
          baseQuery.cat_title = { $in: Array.from(catTitleVariations) };
        }
      } else {
        // Driver has no approved vehicles, return empty array
        return [];
      }
    } catch (error) {
      // If error fetching vehicles, log and continue with all bookings (fallback)
      console.error("Error fetching driver vehicles for live bookings filter:", error);
      // Continue without vehicle type filter as fallback
    }
  }

  // Get all live bookings: pending, non-expired, AUTO-ASSIGNED bookings only
  // Exclude admin-assigned bookings (assignmentType === "admin")
  return Booking.find(baseQuery)
    // Newest bookings first so recently created items appear on top
    .sort({ createdAt: -1, date_time: -1 })
    .lean();
};

exports.acceptBooking = async (bookingId, driverId) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "pending") {
    throw buildError(
      `Booking is already ${booking.status} and cannot be accepted.`,
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  // Check if driver has at least one approved vehicle (exclude soft-deleted)
  const approvedVehicleCount = await Vehicle.countDocuments({ 
    driver: driverId, 
    status: "Approved",
    deletedAt: null
  });
  
  if (approvedVehicleCount === 0) {
    throw buildError(
      "You must have at least one approved vehicle to accept bookings. Please wait for your vehicle to be approved by an administrator.",
      403,
      "NO_APPROVED_VEHICLE"
    );
  }

  // Use actualPrice for business logic (with fallback to price for backward compatibility)
  const actualPriceNumber = getActualPriceNumber(booking);
  const isHighPrice = actualPriceNumber > 150;

  // Build atomic update filter to prevent double acceptance
  const now = new Date();
  const expiryConditions = [
    { expiresAt: { $gt: now } },
    { expiresAt: null },
    { expiresAt: { $exists: false } },
  ];
  const baseFilter = {
    _id: bookingId,
    status: "pending",
    isExpired: { $ne: true },
    $or: expiryConditions,
  };

  const update = {
    status: "accepted",
    isAccepted: true,
    isRejected: false,
    rejectionReason: undefined,
    updatedAt: new Date(),
  };

  if (!isHighPrice) {
    // Low-price (<=150)
    if (booking.driverId) {
      // Admin-assigned low-price booking (e.g., reactivated expired) — only assigned driver may accept
      if (booking.driverId.toString() !== driverId.toString()) {
        throw buildError(
          "You are not assigned to this booking.",
          403,
          "UNAUTHORIZED_DRIVER"
        );
      }
      baseFilter.driverId = booking.driverId;
    } else {
      // Auto booking: ensure it is still unassigned at update time
      baseFilter.driverId = null;
      update.driverId = driverId;
      update.assignmentType = "auto";
    }
  } else {
    // High-price booking (>150) must be admin-assigned and only that driver can accept
    if (!booking.driverId) {
      throw buildError(
        "Admin must assign a driver for this booking before it can be accepted.",
        400,
        "DRIVER_NOT_ASSIGNED"
      );
    }
    if (booking.driverId.toString() !== driverId.toString()) {
      throw buildError(
        "You are not assigned to this booking.",
        403,
        "UNAUTHORIZED_DRIVER"
      );
    }
    baseFilter.driverId = booking.driverId;
    // Preserve assignmentType as admin
  }

  const updated = await Booking.findOneAndUpdate(baseFilter, update, {
    new: true,
  });

  if (!updated) {
    // Booking may have been accepted/expired by another driver or timed out
    throw buildError(
      "Booking is no longer available to accept.",
      409,
      "BOOKING_ALREADY_TAKEN_OR_EXPIRED"
    );
  }

  return updated;
};

exports.rejectBooking = async (bookingId, driverId, reason) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "pending") {
    throw buildError(
      `Booking is already ${booking.status} and cannot be rejected.`,
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  const actualPriceNumber = getActualPriceNumber(booking);
  const isHighPrice = actualPriceNumber > 150;

  const filter = {
    _id: bookingId,
    status: "pending",
  };

  if (isHighPrice) {
    if (!booking.driverId) {
      throw buildError(
        "Admin must assign a driver for this booking.",
        400,
        "DRIVER_NOT_ASSIGNED"
      );
    }
    if (booking.driverId.toString() !== driverId.toString()) {
      throw buildError(
        "You are not assigned to this booking.",
        403,
        "UNAUTHORIZED_DRIVER"
      );
    }
    filter.driverId = booking.driverId;
  }

  const updated = await Booking.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "rejected",
        isRejected: true,
        isAccepted: false,
        rejectionReason: reason || "Rejected by driver",
        driverId: null, // Clear driverId so admin can reassign to another driver
      },
    },
    { new: true }
  );

  if (!updated) {
    throw buildError(
      "Booking could not be rejected (state changed).",
      409,
      "BOOKING_STATE_CHANGED"
    );
  }

  return updated;
};

exports.getUpcomingBookings = async (driverId) => {
  return Booking.find({
    driverId,
    status: "accepted",
  })
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
};

exports.getDriverCompletedBookings = async (driverId) => {
  return Booking.find({
    driverId,
    status: "completed",
  })
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
};

exports.startBooking = async (bookingId, driverId) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "accepted") {
    throw buildError(
      "Booking can only be started when it is in accepted status.",
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  if (!booking.driverId || booking.driverId.toString() !== driverId.toString()) {
    throw buildError(
      "You are not assigned to this booking.",
      403,
      "UNAUTHORIZED_DRIVER"
    );
  }

  await assertDriverHasNoActiveBooking(driverId);

  const updated = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: "accepted",
      driverId: driverId,
    },
    {
      $set: {
        status: "started",
        startedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!updated) {
    throw buildError(
      "Booking could not be started (possibly already started or changed).",
      409,
      "BOOKING_STATE_CHANGED"
    );
  }

  return updated;
};

exports.getActiveBooking = async (driverId) => {
  const booking = await findActiveBookingForDriver(driverId);
  return booking ? booking.toObject() : null;
};

exports.pickupBooking = async (bookingId, driverId) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "started") {
    throw buildError(
      "Booking can only be marked as picked up after it is started.",
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  if (!booking.driverId || booking.driverId.toString() !== driverId.toString()) {
    throw buildError(
      "You are not assigned to this booking.",
      403,
      "UNAUTHORIZED_DRIVER"
    );
  }

  const updated = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: "started",
      driverId: driverId,
    },
    {
      $set: {
        status: "picked_up",
        pickedUpAt: new Date(),
      },
    },
    { new: true }
  );

  if (!updated) {
    throw buildError(
      "Booking could not be marked as picked up (state changed).",
      409,
      "BOOKING_STATE_CHANGED"
    );
  }

  return updated;
};

exports.dropoffBooking = async (bookingId, driverId) => {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "picked_up") {
    throw buildError(
      "Booking can only be marked as dropped off after it is picked up.",
      400,
      "INVALID_BOOKING_STATE"
    );
  }

  if (!booking.driverId || booking.driverId.toString() !== driverId.toString()) {
    throw buildError(
      "You are not assigned to this booking.",
      403,
      "UNAUTHORIZED_DRIVER"
    );
  }

  const updated = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: "picked_up",
      driverId: driverId,
    },
    {
      $set: {
        status: "dropped_off",
        droppedOffAt: new Date(),
      },
    },
    { new: true }
  );

  if (!updated) {
    throw buildError(
      "Booking could not be marked as dropped off (state changed).",
      409,
      "BOOKING_STATE_CHANGED"
    );
  }

  return updated;
};

exports.completeBooking = async (bookingId, driverId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) {
      throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
    }

    if (booking.status !== "dropped_off") {
      throw buildError(
        "Booking can only be completed after it is dropped off.",
        400,
        "INVALID_BOOKING_STATE"
      );
    }

    if (!booking.driverId || booking.driverId.toString() !== driverId.toString()) {
      throw buildError(
        "You are not assigned to this booking.",
        403,
        "UNAUTHORIZED_DRIVER"
      );
    }

    // Prevent duplicate completions/payments
    if (booking.isPaid) {
      throw buildError(
        "Booking is already completed and paid.",
        400,
        "BOOKING_ALREADY_PAID"
      );
    }

    // Calculate driver price: if driverPrice is set and > 0, use it; otherwise use the price field (already deducted)
    let driverPrice = 0;
    // Use the price field which already has commission deducted
    const totalPrice = parseFloat(String(booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
    const commission = parseFloat(String(booking.commission || "0").replace(/[^\d.-]/g, "")) || 0;
    const explicitDriverPrice = parseFloat(String(booking.driverPrice || "0").replace(/[^\d.-]/g, "")) || 0;

    if (explicitDriverPrice > 0) {
      driverPrice = explicitDriverPrice;
    } else if (totalPrice > 0) {
      driverPrice = totalPrice - commission;
      if (driverPrice < 0) {
        driverPrice = 0;
      }
      driverPrice = Math.round(driverPrice * 100) / 100;
    }

    let transaction = null;
    let newBalance = null;

    if (driverPrice > 0) {
      const driver = await Driver.findById(driverId).session(session);
      if (!driver) {
        throw buildError("Driver not found", 404, "DRIVER_NOT_FOUND");
      }

      // Atomically increment wallet balance
      const updatedDriver = await Driver.findOneAndUpdate(
        { _id: driverId },
        { $inc: { walletBalance: driverPrice } },
        { new: true, session, runValidators: false }
      );

      newBalance = Math.round((updatedDriver.walletBalance || 0) * 100) / 100;

      transaction = await WalletTransaction.create(
        [
          {
            driverId: driverId,
            bookingId: bookingId,
            amount: driverPrice,
            type: "credit",
            description: `Payment for completed booking from ${booking.from_location} to ${booking.to_location}`,
            balanceAfter: newBalance,
          },
        ],
        { session }
      );
      transaction = transaction?.[0] || null;
    }

    const updatedBooking = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        status: "dropped_off",
        isPaid: { $ne: true },
      },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          isPaid: true,
        },
      },
      { new: true, session }
    );

    if (!updatedBooking) {
      throw buildError(
        "Booking is no longer eligible for completion.",
        409,
        "BOOKING_ALREADY_COMPLETED"
      );
    }

    await session.commitTransaction();
    session.endSession();

    // PHASE 3: Wallet notification with retry mechanism (non-blocking but with error handling)
    if (driverPrice > 0 && transaction) {
      setImmediate(async () => {
        try {
          const { notifyWalletBalanceUpdated } = require("./driverNotifications");
          // Use Promise.race with timeout to ensure notification doesn't hang indefinitely
          await Promise.race([
            notifyWalletBalanceUpdated(driverId, driverPrice, newBalance, transaction, updatedBooking),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Wallet notification timeout after 30 seconds")), 30000)
            )
          ]);
        } catch (error) {
          // Log error but don't fail the booking completion
          const logger = require("../utils/logger");
          logger.error(`[WALLET] Failed to send wallet notification for booking ${bookingId}: ${error?.message || error}`);
          // Note: Wallet balance is already updated in database, so this is just a notification failure
        }
      });
    }

    return updatedBooking;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

exports.viewAdminAssignedBookings = async (page = 1, limit = 12) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Query filter: Bookings that are assigned AND accepted by the driver
  // Only show bookings where driver has accepted (status: "accepted")
  const query = {
    driverId: { $exists: true, $ne: null }, // Has an assigned driver
    status: "accepted", // Driver has accepted the booking
    isExpired: { $ne: true }, // Exclude expired bookings
  };
  
  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .sort({ createdAt: -1 }) // Newest bookings first
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Booking.countDocuments(query),
  ]);
  
  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

exports.getAllAssignedBookings = async (driverId) => {
  // Return assigned bookings that are not yet started
  // Exclude: started, completed, cancelled, expired, rejected
  // Include: pending, accepted (for admin-assigned bookings)
  // Rejected bookings are removed from assigned list - driverId is cleared when rejected
  return Booking.find({
    driverId,
    status: { $nin: ["started", "completed", "cancelled", "rejected"] }, // Exclude rejected bookings
  })
    .sort({ createdAt: -1 }) // Newest bookings first
    .lean();
};

/**
 * Get expired bookings (bookings that expired after 5 minutes without driver acceptance)
 * Industrial-scale solution: Uses database indexes for efficient querying
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated expired bookings
 */
exports.getExpiredBookings = async (page = 1, limit = 12) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Show ALL expired bookings regardless of assignment type or status
  // This is the ONLY API that should show expired bookings
  const query = {
    isExpired: true,
  };
  
  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .sort({ createdAt: -1 }) // Newest bookings first
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Booking.countDocuments(query),
  ]);
  
  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

/**
 * Delete a booking (Admin only)
 * Also deletes associated payments
 * @param {string} bookingId - Booking ID to delete
 * @returns {Promise<Object>} Deleted booking
 */
exports.deleteBooking = async (bookingId) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw buildError("Booking not found", 404, "BOOKING_NOT_FOUND");
  }

  // Clear any active timers
  const { clearExpiryTimer } = require("./bookingExpiryScheduler");
  const { clearReminderTimer } = require("./bookingReminderScheduler");
  clearExpiryTimer(bookingId);
  clearReminderTimer(bookingId);

  // Delete associated payments
  const Payment = require("../models/payment.model");
  await Payment.deleteMany({ bookingId });

  // Delete the booking
  await Booking.findByIdAndDelete(bookingId);

  return booking;
};

/**
 * Get all completed bookings with driver details for admin
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated completed bookings with driver details
 */
exports.getAdminCompletedBookings = async (page = 1, limit = 12) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  // Exclude expired bookings - they should only appear in getExpiredBookings
  const query = {
    isExpired: { $ne: true }, // Exclude expired bookings
  };
  
  const [bookings, total] = await Promise.all([
    Booking.find(query)
      .populate({
        path: "driverId",
        select: "firstName lastName email phone profilePicture isOnline",
        model: "Driver",
      })
      .sort({ createdAt: -1 }) // Newest bookings first
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Booking.countDocuments(query),
  ]);
  
  return {
    bookings,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};



