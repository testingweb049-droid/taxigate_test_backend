// src/services/bookingNotifications.js
const Admin = require("../models/admin.model");
const Driver = require("../models/driver.model");
const Booking = require("../models/booking.model");
const Vehicle = require("../models/vehicle.model");
const { publishToChannel } = require("../../config/ably");
const { sendToDriver, sendToDrivers } = require("./pushNotification");
const pushNotificationService = require("./pushNotification");
const { channels, events } = require("../utils/notificationEvents");
const sendEmail = require("../utils/email");
const { createNotification } = require("./notification.service");
const { getCatTitleVariations, normalizeVehicleType } = require("../utils/booking.helper");
const logger = require("../utils/logger");

const logAblyError = (context, error) => {
  try {
    const message = error?.message || error;
    logger.error(`[ABLY] ${context}: ${message}`);
    if (error?.stack) {
      logger.error(`[ABLY] ${context} stack trace: ${error.stack}`);
    }
  } catch (logErr) {
    // Swallow logging failures to keep notification flow non-blocking
  }
};

/**
 * PHASE 4: Retry helper for critical notifications
 * @param {Function} publishFn - Function that returns a promise to publish
 * @param {String} context - Context for logging
 * @param {Number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise} Promise that resolves when publish succeeds or all retries exhausted
 */
const publishWithRetry = async (publishFn, context, maxRetries = 3) => {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await publishFn();
      if (attempt > 0) {
        logger.info(`[REALTIME] ${context} succeeded after ${attempt} retries`);
      }
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt), 5000); // Max 5 seconds
        logger.warn(`[REALTIME] ${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffTime}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      } else {
        logger.error(`[REALTIME] ${context} failed after ${maxRetries + 1} attempts: ${error?.message || error}`);
      }
    }
  }
  throw lastError;
};

// Simple in-memory cache for online drivers (short TTL to limit staleness)
const onlineDriversCache = {
  data: null,
  timestamp: null,
  ttl: 5000, // 5 seconds
};
let onlineDriversFetchPromise = null;
let onlineDriversFetchStartedAt = 0;
const ONLINE_DRIVERS_BATCH_WINDOW_MS = 300;

/**
 * Get all online drivers (with or without FCM tokens) from database
 * Uses caching to reduce database load
 * @returns {Promise<Object>} Object with { allDrivers, driversWithTokens, onlineDriverIds }
 */
const getOnlineDrivers = async (retries = 3) => {
  // Check cache first
  const now = Date.now();
  if (
    onlineDriversCache.data &&
    onlineDriversCache.timestamp &&
    (now - onlineDriversCache.timestamp) < onlineDriversCache.ttl
  ) {
    return onlineDriversCache.data;
  }

  // If a fetch is already in-flight and recent, reuse it to batch concurrent callers
  if (
    onlineDriversFetchPromise &&
    now - onlineDriversFetchStartedAt < ONLINE_DRIVERS_BATCH_WINDOW_MS
  ) {
    return onlineDriversFetchPromise;
  }

  onlineDriversFetchStartedAt = now;
  onlineDriversFetchPromise = (async () => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Single query to get all online drivers with their FCM tokens
      
      const allDrivers = await Driver.find({ isOnline: true })
        .select("_id fcmTokens")
        .lean()
        .maxTimeMS(5000); // 5 second timeout for query

      
      // Separate drivers with tokens from those without
      const driversWithTokens = allDrivers.filter((driver) => {
        const hasTokens = driver.fcmTokens && Array.isArray(driver.fcmTokens) && driver.fcmTokens.length > 0;
        return hasTokens;
      });

      const onlineDriverIds = allDrivers.map((d) => d._id.toString());

      
      // Cache the result
  const result = {
    allDrivers,
    driversWithTokens,
    onlineDriverIds,
  };

  onlineDriversCache.data = result;
  onlineDriversCache.timestamp = now;

  return result;
    } catch (error) {
      
      if (attempt < retries) {
        // Wait before retry (exponential backoff)
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        return {
          allDrivers: [],
          driversWithTokens: [],
          onlineDriverIds: [],
        };
      }
    }
  }
  return {
    allDrivers: [],
    driversWithTokens: [],
    onlineDriverIds: [],
  };
  })();

  try {
    const result = await onlineDriversFetchPromise;
    return result;
  } finally {
    onlineDriversFetchPromise = null;
    onlineDriversFetchStartedAt = 0;
  }
};

const invalidateOnlineDriversCache = () => {
  onlineDriversCache.data = null;
  onlineDriversCache.timestamp = null;
};

/**
 * Get online drivers with FCM tokens from database
 * @deprecated Use getOnlineDrivers() instead for better performance
 * @returns {Promise<Array>} Array of driver objects with _id and fcmTokens
 */
const getOnlineDriversWithTokens = async (retries = 3) => {
  const result = await getOnlineDrivers(retries);
  return result.driversWithTokens;
};

/**
 * Filter drivers by vehicle type matching the booking's cat_title
 * Handles both Dutch and English vehicle type variations
 * Business rule: Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
 * Taxi Bus bookings can only be handled by Taxi Bus vehicles
 * @param {Array} drivers - Array of driver objects with _id
 * @param {string} bookingCatTitle - Booking's cat_title (can be in Dutch or English)
 * @returns {Promise<Array>} Filtered array of drivers with matching vehicle types
 */
const filterDriversByVehicleType = async (drivers, bookingCatTitle) => {
  if (!drivers || drivers.length === 0 || !bookingCatTitle) {
    return drivers || [];
  }

  try {
    // Normalize to lowercase for case-insensitive matching
    const normalized = String(bookingCatTitle).trim().toLowerCase();
    
    // Determine which vehicle types should match this booking
    // Business rule: Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
    let matchingVehicleTypes = [];
    
    if (normalized === "standard" || normalized === "standaard" || 
        normalized === "luxury" || normalized === "luxe") {
      // Standard/Standaard and Luxury/Luxe bookings can be handled by EITHER Standard OR Luxury vehicles
      matchingVehicleTypes = ["Standard", "Luxury"];
    } else if (normalized === "taxi bus" || normalized === "taxibus" || normalized === "taxi-bus") {
      // Taxi Bus bookings can only be handled by Taxi Bus vehicles
      matchingVehicleTypes = ["Taxi Bus"];
    } else {
      // If cat_title doesn't match any known vehicle type, return all drivers (fallback)
      return drivers;
    }

    // Get all driver IDs
    const driverIds = drivers.map(d => d._id);
    
    // Get all approved vehicles for these drivers that match any of the matching vehicle types
    const matchingVehicles = await Vehicle.find({
      driver: { $in: driverIds },
      status: "Approved",
      deletedAt: null,
      type: { $in: matchingVehicleTypes }, // Match any of the allowed vehicle types
    }).select("driver").lean();

    // Get unique driver IDs from matching vehicles
    const matchingDriverIds = new Set(
      matchingVehicles.map(v => v.driver.toString())
    );

    // Filter drivers to only those with matching vehicle types
    return drivers.filter(d => matchingDriverIds.has(d._id.toString()));
  } catch (error) {
    // If error filtering, return all drivers (fallback to avoid breaking notifications)
    logger.error(`[NOTIFICATION] Error filtering drivers by vehicle type: ${error?.message || error}`);
    return drivers;
  }
};

/**
 * Normalize booking object for notifications
 * @param {Object} booking - Booking object
 * @returns {Object} Normalized booking data
 */
const normalizeBookingForNotification = (booking) => {
  return {
    bookingId: booking._id?.toString() || booking.id,
    from_location: booking.from_location,
    to_location: booking.to_location,
    price: booking.price, // Driver price (already deducted)
    actualPrice: booking.actualPrice || booking.price, // Original price (for backward compatibility, fallback to price)
    date_time: booking.date_time instanceof Date 
      ? booking.date_time.toISOString() 
      : booking.date_time,
    cat_title: booking.cat_title,
    luggage: booking.luggage, // Include luggage in notification payload
    stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : [],
    stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : [],
    distance: booking.distance,
    num_passengers: booking.num_passengers,
    status: booking.status || "pending", // Default to "pending" if undefined
    assignmentType: booking.assignmentType,
    driverId: booking.driverId?.toString() || booking.driverId,
    pickupCoordinates: booking.pickupCoordinates,
    dropoffCoordinates: booking.dropoffCoordinates,
  };
};

/**
 * Normalize booking object to match API response format (for live booking updates)
 * This includes all fields that the frontend needs to update the list without refetching
 * @param {Object} booking - Booking object
 * @returns {Object} Full booking data matching API response
 */
const normalizeBookingForLiveUpdate = (booking) => {
  if (!booking) return null;
  return {
    id: booking._id?.toString() || booking.id,
    from_location: booking.from_location,
    to_location: booking.to_location,
    luggage: booking.luggage,
    num_passengers: booking.num_passengers,
    date_time: booking.date_time instanceof Date 
      ? booking.date_time.toISOString() 
      : booking.date_time,
    return_date_time: booking.return_date_time instanceof Date
      ? booking.return_date_time.toISOString()
      : booking.return_date_time,
    cat_title: booking.cat_title,
    price: booking.price, // Driver price (already deducted, shown to drivers)
    actualPrice: booking.actualPrice || booking.price, // Original price (for admin/backward compatibility)
    user_name: booking.user_name,
    email: booking.email,
    number: booking.number,
    note_description: booking.note_description,
    stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : [],
    stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : [],
    flight_no: booking.flight_no,
    distance: booking.distance,
    commission: booking.commission,
    driverPrice: booking.driverPrice,
    driverId: booking.driverId?.toString() || booking.driverId,
    assignmentType: booking.assignmentType,
    status: booking.status || "pending", // Default to "pending" if undefined
    isAccepted: booking.isAccepted,
    isRejected: booking.isRejected,
    rejectionReason: booking.rejectionReason,
    startedAt: booking.startedAt instanceof Date
      ? booking.startedAt.toISOString()
      : booking.startedAt,
    pickedUpAt: booking.pickedUpAt instanceof Date
      ? booking.pickedUpAt.toISOString()
      : booking.pickedUpAt,
    droppedOffAt: booking.droppedOffAt instanceof Date
      ? booking.droppedOffAt.toISOString()
      : booking.droppedOffAt,
    completedAt: booking.completedAt instanceof Date
      ? booking.completedAt.toISOString()
      : booking.completedAt,
    pickupCoordinates: booking.pickupCoordinates,
    dropoffCoordinates: booking.dropoffCoordinates,
    isPaid: booking.isPaid,
    expiresAt: booking.expiresAt instanceof Date
      ? booking.expiresAt.toISOString()
      : booking.expiresAt,
    expiredAt: booking.expiredAt instanceof Date
      ? booking.expiredAt.toISOString()
      : booking.expiredAt,
    isExpired: booking.isExpired,
    createdAt: booking.createdAt instanceof Date
      ? booking.createdAt.toISOString()
      : booking.createdAt,
    updatedAt: booking.updatedAt instanceof Date
      ? booking.updatedAt.toISOString()
      : booking.updatedAt,
  };
};

/**
 * Send FCM push notifications to all online drivers with FCM tokens
 * This function is called ONLY for auto-assigned bookings (price <= 150)
 * Push notifications are NOT sent for admin-assigned bookings (price > 150)
 * 
 * @param {Object} booking - Booking object (should be auto-assigned with price <= 150)
 * @returns {Promise<Object>} Result object with success status
 */
const notifyAllDriversNewBooking = async (booking) => {
  
  try {
    
    
    const bookingData = normalizeBookingForNotification(booking);
    
    // Get all online drivers with FCM tokens
    const { driversWithTokens, onlineDriverIds } = await getOnlineDrivers();
    
    
    if (driversWithTokens.length === 0) {
      return { success: false, message: "No online drivers with FCM tokens found" };
    }
    
    // Filter drivers by vehicle type matching the booking's cat_title
    // This ensures only drivers with matching vehicle types receive notifications
    // Handles both Dutch ("Standaard", "Luxe") and English ("Standard", "Luxury") variations
    const filteredDrivers = await filterDriversByVehicleType(driversWithTokens, booking.cat_title);
    
    if (filteredDrivers.length === 0) {
      return { success: false, message: "No online drivers with matching vehicle types found" };
    }
    
    // Log driver details
    filteredDrivers.forEach((driver, idx) => {
      const tokenCount = driver.fcmTokens?.length || 0;
    });
    
    // Send FCM push notifications to filtered drivers with matching vehicle types
    
    // Ensure Firebase is initialized before sending
    try {
      if (pushNotificationService.ensureFirebaseInitialized) {
        pushNotificationService.ensureFirebaseInitialized();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (firebaseInitError) {
    }
    
    
    // Log driver IDs being sent
    const driverIdsToNotify = filteredDrivers.map((d) => d._id.toString());
    
    try {
      const pushResult = await sendToDrivers(
        driverIdsToNotify,
        {
          title: "New Booking Available! 🚕",
          body: `From ${booking.from_location} to ${booking.to_location} - ${booking.price}`,
        },
        {
          event: events.NEW_BOOKING,
          ...bookingData,
        }
      );
      
      
      if (!pushResult) {
      } else if (pushResult.error) {
      } else if (pushResult.success > 0) {
      } else {
      }
    } catch (pushError) {
      if (pushError.code) {
      }
      if (pushError.stack) {
      }
      if (pushError.stack) {
      }
    }
    
    
    // Return success indicator
    return { success: true, message: "FCM push notifications processed" };
  } catch (error) {
    if (error.code) {
    }
    if (error.stack) {
    }
    if (error.stack) {
    }
    
    // Return error indicator
    return { success: false, error: error.message };
  }
};

/**
 * Notify all online drivers about a new auto-assigned booking
 * @param {Object} booking - Booking object
 */
const notifyNewBooking = async (booking) => {
  try {
    
    // Only notify for auto-assigned bookings (price <= 150)
    const priceNumber = parseFloat(String(booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
    if (priceNumber > 150 || booking.assignmentType !== "auto") {
      return;
    }

    
    const bookingData = normalizeBookingForNotification(booking);
    
    // Single optimized query to get all online drivers
    const { allDrivers, driversWithTokens, onlineDriverIds } = await getOnlineDrivers();
    
    if (allDrivers.length === 0) {
      return;
    }

    // Filter drivers by vehicle type matching the booking's cat_title
    // This ensures only drivers with matching vehicle types receive Ably notifications
    // Handles both Dutch ("Standaard", "Luxe") and English ("Standard", "Luxury") variations
    const filteredAllDrivers = await filterDriversByVehicleType(allDrivers, booking.cat_title);
    const filteredDriversWithTokens = await filterDriversByVehicleType(driversWithTokens, booking.cat_title);
    
    if (filteredAllDrivers.length === 0) {
      // No drivers with matching vehicle types, skip notification
      return;
    }

    // Get filtered driver IDs for Ably notification
    const filteredDriverIds = filteredAllDrivers.map(d => d._id.toString());

    driversWithTokens.forEach((driver, idx) => {
    });

    // Use filtered drivers with FCM tokens for push notifications, or filtered all drivers if none have tokens
    const driversForFCM = filteredDriversWithTokens.length > 0 ? filteredDriversWithTokens : filteredAllDrivers;

    // Send Ably real-time event (for in-app updates when app is open)
    // Send to filtered online drivers (with matching vehicle types)
    // Fire-and-forget: don't await, just log errors
    publishToChannel(channels.DRIVERS, events.NEW_BOOKING, {
      ...bookingData,
      onlineDriverIds: filteredDriverIds, // Only send to drivers with matching vehicle types
      timestamp: new Date().toISOString(),
    }).then(() => {
    }).catch((ablyError) => {
      // Log error but don't block - Ably is fire-and-forget
    });

    
    // NOTE: FCM push notifications are now handled by notifyAllDriversNewBooking() 
    // which is called for ALL bookings (regardless of price) in STEP 2.
    // This function (notifyNewBooking) only handles Ably real-time notifications
    // for auto-assigned bookings (price <= 150) to avoid duplicate FCM notifications.
    
    // Removed all FCM push notification code from this function to prevent duplicates
    // FCM notifications are now sent via notifyAllDriversNewBooking() in STEP 2
    

    // Create notification in database for admin users
    try {
      const admins = await Admin.find({ active: true }).select("_id email name").lean();
      
      const notificationPromises = admins.map(async (admin) => {
        try {
          const notification = await createNotification({
            type: "booking-created",
            title: `New Booking Created`,
            message: `A new booking from ${booking.from_location} to ${booking.to_location} has been created.`,
            bookingId: booking._id,
            bookingDetails: {
              from_location: booking.from_location,
              to_location: booking.to_location,
              price: booking.price,
              user_name: booking.user_name,
              email: booking.email,
            },
            priority: "medium",
            data: {
              bookingId: bookingData.bookingId,
              from_location: booking.from_location,
              to_location: booking.to_location,
              price: booking.price,
            },
          });
          return notification;
        } catch (notifError) {
          return null;
        }
      });

      await Promise.allSettled(notificationPromises);
      
      // NOTE: Ably booking-created-admin event is already sent by notifyAdminBookingCreated() in STEP 1
      // Do not send duplicate event here to avoid duplicate notifications in admin dashboard
    } catch (notifError) {
      // Don't throw - this is non-critical
    }

    // Calculate total FCM tokens from drivers with tokens
    const totalFCMTokens = driversWithTokens.reduce((total, driver) => {
      return total + (driver.fcmTokens?.length || 0);
    }, 0);
  } catch (error) {
    throw error; // Re-throw so controller can catch it
  }
};

/**
 * Notify other drivers that a booking was accepted (remove from their list)
 * @param {Object} booking - Booking object
 * @param {String} acceptingDriverId - ID of driver who accepted the booking
 */
const notifyBookingAccepted = async (booking, acceptingDriverId) => {
  try {
    const bookingData = normalizeBookingForNotification(booking);
    
    // Get all online drivers (optimized single query)
    const { allDrivers, driversWithTokens, onlineDriverIds: allOnlineDriverIds } = await getOnlineDrivers();

    // Filter out the driver who accepted the booking
    const otherDrivers = driversWithTokens.filter(
      (d) => d._id.toString() !== acceptingDriverId.toString()
    );

    // Filter other drivers by vehicle type matching the booking's cat_title
    // This ensures only drivers with matching vehicle types are notified that booking is taken
    // Handles both Dutch ("Standaard", "Luxe") and English ("Standard", "Luxury") variations
    const filteredOtherDrivers = await filterDriversByVehicleType(otherDrivers, booking.cat_title);

    // Filter online driver IDs to exclude the accepting driver and only include those with matching vehicle types
    const filteredDriverIds = filteredOtherDrivers.map(d => d._id.toString());
    const onlineDriverIds = filteredDriverIds.filter(
      (id) => id !== acceptingDriverId.toString()
    );

    // Send Ably real-time event to remove booking from other drivers' lists
    // This works even if drivers don't have FCM tokens
    // Fire-and-forget: don't await, just log errors
    if (onlineDriverIds.length > 0) {
      publishToChannel(channels.DRIVERS, events.BOOKING_TAKEN, {
        bookingId: bookingData.bookingId,
        takenBy: acceptingDriverId.toString(),
        timestamp: new Date().toISOString(),
        onlineDriverIds,
      }).then(() => {
      }).catch((ablyError) => {
      });
    }

    // Send FCM push notifications to filtered other drivers (only those with FCM tokens and matching vehicle types)
    if (filteredOtherDrivers.length > 0) {
      const allTokens = filteredOtherDrivers.flatMap((driver) => driver.fcmTokens || []);
      
      if (allTokens.length > 0) {
        
        const pushResult = await sendToDrivers(
          filteredOtherDrivers.map((d) => d._id.toString()),
          {
            title: "Booking Taken ⚠️",
            body: `Booking from ${booking.from_location} to ${booking.to_location} was accepted by another driver`,
          },
          {
            event: events.BOOKING_TAKEN,
            bookingId: bookingData.bookingId,
            takenBy: acceptingDriverId.toString(),
          }
        );
        
        if (pushResult && pushResult.success > 0) {
        } else if (pushResult) {
        }
      } else {
      }
    }

    // Normalize booking data for notifications (needed for both admin and driver notifications)
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    // PHASE 1 FIX: Remove booking from LIVE BOOKING API for ALL drivers when auto-assigned booking is accepted
    // Check if this is an auto-assigned booking (not admin-assigned)
    const assignmentType = booking.assignmentType || booking.assignment_type;
    const bookingId = booking._id?.toString() || booking.id || bookingData.bookingId;
    
    // Only remove from LIVE for auto-assigned bookings (admin-assigned bookings are not in LIVE)
    if (assignmentType === "auto" && bookingId) {
      const liveBookingRemovedData = {
        bookingId: bookingId,
        action: "removed",
        reason: "driver_accepted",
        timestamp: new Date().toISOString(),
      };
      
      // PHASE 1: Send to ALL drivers via broadcast channel (removes from LIVE for everyone)
      try {
        await publishToChannel(channels.DRIVERS, events.LIVE_BOOKING_REMOVED, {
          ...liveBookingRemovedData,
          onlineDriverIds: allOnlineDriverIds, // All online drivers
        });
        logger.info(`[REALTIME] Sent LIVE_BOOKING_REMOVED to ALL drivers for booking ${bookingId} (auto-assigned accepted)`);
      } catch (ablyError) {
        logAblyError("notifyBookingAccepted:live-removed-all-drivers", ablyError);
      }

      // Also send to admin channel to remove from admin's LIVE view
      publishToChannel(channels.ADMIN, events.LIVE_BOOKING_REMOVED, liveBookingRemovedData)
        .then(() => {
          logger.info(`[REALTIME] Sent LIVE_BOOKING_REMOVED to admin for booking ${bookingId}`);
        })
        .catch((ablyError) => {
          logAblyError("notifyBookingAccepted:live-removed-admin", ablyError);
        });
    }
    
    // Notify admin when driver accepts booking - ONLY for admin-assigned bookings
    // Use full booking data so admin dashboard can update without refetching
    if (assignmentType === "admin") {
      const admins = await Admin.find({ active: true }).select("_id email name").lean();
      const adminIds = admins.map((a) => a._id.toString());
      
      if (adminIds.length > 0 && fullBookingData) {
        // PHASE 3: For admin-assigned bookings, keep in ASSIGNED API (not move to UPCOMING)
        // Send booking-accepted-admin event to admin for real-time updates
        publishToChannel(channels.ADMIN, events.BOOKING_ACCEPTED_ADMIN, {
          ...fullBookingData,
          stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
          stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (fullBookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
          pickupCoordinates: booking.pickupCoordinates || fullBookingData.pickupCoordinates, // Ensure pickup coordinates are included
          dropoffCoordinates: booking.dropoffCoordinates || fullBookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
          acceptedBy: acceptingDriverId.toString(),
          timestamp: new Date().toISOString(),
          adminIds,
          message: `Driver accepted the admin-assigned booking from ${booking.from_location} to ${booking.to_location}`,
          assignmentType: "admin",
        }).then(() => {
          logger.info(`[REALTIME] Sent BOOKING_ACCEPTED_ADMIN for booking ${bookingId}`);
        }).catch((ablyError) => {
          logAblyError("notifyBookingAccepted:admin-accepted", ablyError);
        });
      }
      
      // PHASE 3: Do NOT send UPCOMING_BOOKING_ADDED for admin-assigned bookings
      // Admin-assigned bookings stay in ASSIGNED API, not UPCOMING
      logger.info(`[REALTIME] Skipping UPCOMING_BOOKING_ADDED for admin-assigned booking ${bookingId} (stays in ASSIGNED API)`);
    } else {
      // PHASE 1: Step 2: Add booking to upcoming bookings (for accepting driver) - ONLY for auto-assigned
      // This happens AFTER removing from live bookings to ensure correct UI state
      if (fullBookingData) {
        const driverChannelName = channels.DRIVER(acceptingDriverId.toString());
        const upcomingBookingData = {
          booking: fullBookingData,
          driverId: acceptingDriverId.toString(),
          action: "added",
          timestamp: new Date().toISOString(),
        };
        
        // Publish to driver-specific channel (primary) - ADD to upcoming bookings
        publishToChannel(driverChannelName, events.UPCOMING_BOOKING_ADDED, upcomingBookingData)
          .then(() => {
            logger.info(`[REALTIME] Sent UPCOMING_BOOKING_ADDED to accepting driver ${acceptingDriverId} for booking ${bookingId}`);
          })
          .catch((ablyError) => {
            logAblyError(`notifyBookingAccepted:upcoming-added-driver-${acceptingDriverId}`, ablyError);
          });

        // Also publish to drivers channel for broadcast compatibility
        publishToChannel(channels.DRIVERS, events.UPCOMING_BOOKING_ADDED, upcomingBookingData)
          .then(() => {
          })
          .catch((ablyError) => {
            logAblyError("notifyBookingAccepted:upcoming-added-broadcast", ablyError);
          });
      }
    }
  } catch (error) {
    logAblyError("notifyBookingAccepted", error);
  }
};

/**
 * Notify assigned driver about admin-assigned booking
 * PHASE 3: Admin-assigned bookings go to ASSIGNED API, NOT LIVE API
 * @param {Object} booking - Booking object
 * @param {String} driverId - ID of assigned driver
 */
const notifyBookingAssigned = async (booking, driverId) => {
  try {
    
    const bookingData = normalizeBookingForNotification(booking);
    const fullBookingData = normalizeBookingForLiveUpdate(booking);

    // Send Ably real-time event to assigned driver via driver-specific channel
    // This ensures instant delivery to the specific driver
    const driverChannelName = channels.DRIVER(driverId.toString());
    const driverNotificationData = {
      ...bookingData,
      luggage: booking.luggage || bookingData.luggage, // Ensure luggage is included
      stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (bookingData.stops || []), // Ensure stops array is included
      stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (bookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
      pickupCoordinates: booking.pickupCoordinates || bookingData.pickupCoordinates, // Ensure pickup coordinates are included
      dropoffCoordinates: booking.dropoffCoordinates || bookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
      assignedTo: driverId.toString(),
      timestamp: new Date().toISOString(),
    };

    // Publish to driver-specific channel (primary)
    publishToChannel(driverChannelName, events.BOOKING_ASSIGNED, driverNotificationData)
      .then(() => {
        logger.info(`[REALTIME] Sent BOOKING_ASSIGNED to driver ${driverId} for booking ${bookingData.bookingId}`);
      })
      .catch((ablyError) => {
        logAblyError(`notifyBookingAssigned:driver-${driverId}`, ablyError);
      });

    // Also publish to drivers channel for broadcast compatibility (optional, for apps that still listen to drivers channel)
    publishToChannel(channels.DRIVERS, events.BOOKING_ASSIGNED, {
      ...driverNotificationData,
      onlineDriverIds: [driverId.toString()],
    }).then(() => {
    }).catch((ablyError) => {
      logAblyError("notifyBookingAssigned:drivers-broadcast", ablyError);
    });

    // PHASE 3: Send assigned-booking-added event to add booking to driver's ASSIGNED API
    // Admin-assigned bookings should NOT appear in LIVE API, only in ASSIGNED API
    if (fullBookingData) {
      const assignedBookingData = {
        booking: fullBookingData,
        driverId: driverId.toString(),
        action: "added",
        timestamp: new Date().toISOString(),
      };
      
      // Publish to driver-specific channel (primary) - ADD to assigned bookings
      publishToChannel(driverChannelName, events.ASSIGNED_BOOKING_ADDED, assignedBookingData)
        .then(() => {
          logger.info(`[REALTIME] Sent ASSIGNED_BOOKING_ADDED to driver ${driverId} for booking ${bookingData.bookingId}`);
        })
        .catch((ablyError) => {
          logAblyError(`notifyBookingAssigned:assigned-added-driver-${driverId}`, ablyError);
        });

      // Also publish to drivers channel for broadcast compatibility
      publishToChannel(channels.DRIVERS, events.ASSIGNED_BOOKING_ADDED, assignedBookingData)
        .then(() => {
        })
        .catch((ablyError) => {
          logAblyError("notifyBookingAssigned:assigned-added-broadcast", ablyError);
        });
    }

    // Send Ably real-time event to admin channel for real-time dashboard update
    // Use full booking data so admin dashboard can update without refetching
    // This notifies admin that they have successfully assigned a booking to a driver
    if (fullBookingData) {
      const admins = await Admin.find({ active: true }).select("_id email name").lean();
      const adminIds = admins.map((a) => a._id.toString());
      
      if (adminIds.length > 0) {
        publishToChannel(channels.ADMIN, events.BOOKING_ASSIGNED, {
          ...fullBookingData,
          luggage: booking.luggage || fullBookingData.luggage, // Ensure luggage is included
          stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
          stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (fullBookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
          pickupCoordinates: booking.pickupCoordinates || fullBookingData.pickupCoordinates, // Ensure pickup coordinates are included
          dropoffCoordinates: booking.dropoffCoordinates || fullBookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
          assignedTo: driverId.toString(),
          timestamp: new Date().toISOString(),
          adminIds,
          message: `Booking assigned to driver: ${booking.from_location} → ${booking.to_location}`,
          assignmentType: "admin",
        }).then(() => {
        }).catch((ablyError) => {
        });
      }
    }

    // Send FCM push notification (fire-and-forget to avoid delays)
    // Don't await - send in background to prevent blocking Ably notifications
    setImmediate(async () => {
      try {
        const driver = await Driver.findById(driverId).select("fcmTokens").lean();
        if (driver && driver.fcmTokens && Array.isArray(driver.fcmTokens) && driver.fcmTokens.length > 0) {
          // Build push notification data - explicitly include luggage and stops fields
          // Ensure luggage and stops are always included in the data payload
          const pushNotificationData = {
            event: events.BOOKING_ASSIGNED,
            bookingId: bookingData.bookingId,
            from_location: bookingData.from_location,
            to_location: bookingData.to_location,
            price: bookingData.price,
            actualPrice: bookingData.actualPrice,
            date_time: bookingData.date_time,
            cat_title: bookingData.cat_title,
            luggage: booking.luggage !== undefined ? booking.luggage : (bookingData.luggage !== undefined ? bookingData.luggage : ""), // Explicitly include luggage
            stops: bookingData.stops || [], // Include stops array
            distance: bookingData.distance,
            num_passengers: bookingData.num_passengers,
            status: bookingData.status,
            assignmentType: bookingData.assignmentType,
            driverId: bookingData.driverId,
          };
          
          await sendToDriver(
            driverId,
            {
              title: "Booking Assigned to You! ✅",
              body: `You have been assigned a booking from ${booking.from_location} to ${booking.to_location}`,
            },
            pushNotificationData
          );
        }
      } catch (pushError) {
        // Log but don't fail - push notification is non-critical
        logAblyError("notifyBookingAssigned:push-notification", pushError);
      }
    });

  } catch (error) {
  }
};

/**
 * Notify driver that they have been unassigned from a booking
 * @param {Object} booking - Booking object
 * @param {String} driverId - ID of unassigned driver
 */
const notifyBookingUnassigned = async (booking, driverId) => {
  try {
    
    const bookingData = normalizeBookingForNotification(booking);
    const fullBookingData = normalizeBookingForLiveUpdate(booking);

    // Send Ably real-time event to unassigned driver via driver-specific channel
    const driverChannelName = channels.DRIVER(driverId.toString());
    const driverNotificationData = {
      ...bookingData,
      stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (bookingData.stops || []), // Ensure stops array is included
      stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (bookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
      pickupCoordinates: booking.pickupCoordinates || bookingData.pickupCoordinates, // Ensure pickup coordinates are included
      dropoffCoordinates: booking.dropoffCoordinates || bookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
      unassignedFrom: driverId.toString(),
      timestamp: new Date().toISOString(),
    };

    // Publish to driver-specific channel (primary)
    publishToChannel(driverChannelName, events.BOOKING_UNASSIGNED, driverNotificationData)
      .then(() => {
      })
      .catch((ablyError) => {
      });

    // Also publish to drivers channel for broadcast compatibility
    publishToChannel(channels.DRIVERS, events.BOOKING_UNASSIGNED, {
      ...driverNotificationData,
      onlineDriverIds: [driverId.toString()],
    }).then(() => {
    }).catch((ablyError) => {
    });

    // Send Ably real-time event to admin channel for real-time dashboard updates
    if (fullBookingData) {
      const admins = await Admin.find({ active: true }).select("_id email name").lean();
      const adminIds = admins.map((a) => a._id.toString());
      
      if (adminIds.length > 0) {
        const adminNotificationData = {
          ...fullBookingData,
          stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
          stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (fullBookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
          pickupCoordinates: booking.pickupCoordinates || fullBookingData.pickupCoordinates, // Ensure pickup coordinates are included
          dropoffCoordinates: booking.dropoffCoordinates || fullBookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
          unassignedFrom: driverId.toString(),
          timestamp: new Date().toISOString(),
          adminIds,
        };

        publishToChannel(channels.ADMIN, events.BOOKING_UNASSIGNED, adminNotificationData).then(() => {
        }).catch((ablyError) => {
        });
      }
    }

    // Check if driver has FCM tokens before sending FCM push notification
    const driver = await Driver.findById(driverId).select("fcmTokens").lean();
    if (driver && driver.fcmTokens && Array.isArray(driver.fcmTokens) && driver.fcmTokens.length > 0) {
      await sendToDriver(
        driverId,
        {
          title: "Booking Unassigned ⚠️",
          body: `You have been unassigned from the booking from ${booking.from_location} to ${booking.to_location}`,
        },
        {
          event: events.BOOKING_UNASSIGNED,
          ...bookingData,
        }
      );
    } else {
    }

  } catch (error) {
  }
};

/**
 * Notify driver about booking status updates (started, picked up, dropped off, completed)
 * @param {Object} booking - Booking object
 * @param {String} driverId - ID of driver
 * @param {String} status - New booking status
 */
const notifyBookingStatusUpdate = async (booking, driverId, status) => {
  try {
    
    const bookingData = normalizeBookingForNotification(booking);
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    // Map status to notification messages and event constants
    const statusMessages = {
      started: {
        title: "Booking Started! 🚗",
        body: `You have started the booking from ${booking.from_location} to ${booking.to_location}`,
        event: events.BOOKING_STARTED,
      },
      picked_up: {
        title: "Passenger Picked Up! 👥",
        body: `Passenger picked up from ${booking.from_location}. Heading to ${booking.to_location}`,
        event: events.BOOKING_PICKED_UP,
      },
      dropped_off: {
        title: "Passenger Dropped Off! ✅",
        body: `Passenger dropped off at ${booking.to_location}`,
        event: events.BOOKING_DROPPED_OFF,
      },
      completed: {
        title: "Booking Completed! 🎉",
        body: `Booking from ${booking.from_location} to ${booking.to_location} has been completed`,
        event: events.BOOKING_COMPLETED,
      },
    };

    const message = statusMessages[status];
    if (!message) {
      return;
    }

    // Send Ably real-time event to driver via driver-specific channel
    const driverChannelName = channels.DRIVER(driverId.toString());
    const driverNotificationData = {
      ...bookingData,
      stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (bookingData.stops || []), // Ensure stops array is included
      status,
      driverId: driverId.toString(),
      timestamp: new Date().toISOString(),
    };

    // Publish to driver-specific channel (primary)
    publishToChannel(driverChannelName, message.event, driverNotificationData)
      .then(() => {
      })
      .catch((ablyError) => {
      });

    // Also publish to drivers channel for broadcast compatibility
    publishToChannel(channels.DRIVERS, message.event, {
      ...driverNotificationData,
      onlineDriverIds: [driverId.toString()],
    }).then(() => {
    }).catch((ablyError) => {
    });

    // Send Ably real-time event to admin channel for real-time dashboard updates
    // Use full booking data so admin dashboard can update without refetching
    // NOTE: Skip admin notifications for "completed" status - handled by notifyAdminBookingCompleted()
    // to avoid duplicate notifications
    if (status !== "completed" && fullBookingData) {
        const admins = await Admin.find({ active: true }).select("_id email name").lean();
        const adminIds = admins.map((a) => a._id.toString());
        
        if (adminIds.length > 0) {
          const adminNotificationData = {
            ...fullBookingData,
            stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
            stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (fullBookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
            pickupCoordinates: booking.pickupCoordinates || fullBookingData.pickupCoordinates, // Ensure pickup coordinates are included
            dropoffCoordinates: booking.dropoffCoordinates || fullBookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
            status,
            driverId: driverId.toString(),
            timestamp: new Date().toISOString(),
            adminIds,
          };

          publishToChannel(channels.ADMIN, message.event, adminNotificationData).then(() => {
          }).catch((ablyError) => {
          });
        }
    } else {
    }

    // Handle upcoming and active booking updates for driver
    if (status === "started" && fullBookingData) {
      const driverChannelName = channels.DRIVER(driverId.toString());
      
      // Remove from upcoming bookings (status changed from "accepted" to "started")
      const upcomingRemovedData = {
        bookingId: fullBookingData.id || fullBookingData.bookingId,
        driverId: driverId.toString(),
        action: "removed",
        timestamp: new Date().toISOString(),
      };
      
      // Publish to driver-specific channel (primary)
      publishToChannel(driverChannelName, events.UPCOMING_BOOKING_REMOVED, upcomingRemovedData)
        .then(() => {
        })
        .catch((ablyError) => {
        });

      // Also publish to drivers channel for broadcast compatibility
      publishToChannel(channels.DRIVERS, events.UPCOMING_BOOKING_REMOVED, upcomingRemovedData)
        .then(() => {
        })
        .catch((ablyError) => {
        });

      // Remove from assigned bookings list (status changed from "accepted" to "started")
      // This ensures the assigned bookings API updates in real-time
      const assignedRemovedData = {
        bookingId: fullBookingData.id || fullBookingData.bookingId,
        driverId: driverId.toString(),
        action: "removed",
        reason: "booking_started",
        status: "started",
        timestamp: new Date().toISOString(),
      };
      
      // Publish to driver-specific channel (primary)
      publishToChannel(driverChannelName, events.ASSIGNED_BOOKING_REMOVED, assignedRemovedData)
        .then(() => {
        })
        .catch((ablyError) => {
        });

      // Also publish to drivers channel for broadcast compatibility
      publishToChannel(channels.DRIVERS, events.ASSIGNED_BOOKING_REMOVED, assignedRemovedData)
        .then(() => {
        })
        .catch((ablyError) => {
        });

      // Add/update in active booking (status is now "started")
      const activeBookingData = {
        booking: fullBookingData,
        driverId: driverId.toString(),
        action: "updated",
        timestamp: new Date().toISOString(),
      };
      
      // Publish to driver-specific channel (primary)
      publishToChannel(driverChannelName, events.ACTIVE_BOOKING_UPDATED, activeBookingData)
        .then(() => {
        })
        .catch((ablyError) => {
        });

      // Also publish to drivers channel for broadcast compatibility
      publishToChannel(channels.DRIVERS, events.ACTIVE_BOOKING_UPDATED, activeBookingData)
        .then(() => {
        })
        .catch((ablyError) => {
        });
    }

    // NOTE: FCM push notifications removed - only real-time Ably updates are sent
    // This reduces notification noise and improves performance

  } catch (error) {
  }
};

/**
 * Notify driver about booking rejection
 * @param {Object} booking - Booking object
 * @param {String} driverId - ID of driver who rejected
 */
const notifyBookingRejected = async (booking, driverId) => {
  try {
    
    const bookingData = normalizeBookingForNotification(booking);
    
    // Get all online drivers (optimized single query)
    const { onlineDriverIds: allOnlineDriverIds } = await getOnlineDrivers();
    
    // Filter out the rejecting driver
    const onlineDriverIds = allOnlineDriverIds.filter(
      (id) => id !== driverId.toString()
    );

    // Send Ably real-time event (booking is still available for others)
    // Fire-and-forget: don't await, just log errors
    if (onlineDriverIds.length > 0) {
      publishToChannel(channels.DRIVERS, events.BOOKING_REJECTED, {
        ...bookingData,
        rejectedBy: driverId.toString(),
        timestamp: new Date().toISOString(),
        onlineDriverIds,
      }).then(() => {
      }).catch((ablyError) => {
      });
    }

    // Get online drivers (optimized single query)
    const { driversWithTokens } = await getOnlineDrivers();
    const otherDrivers = driversWithTokens.filter(
      (d) => d._id.toString() !== driverId.toString()
    );

    // Filter other drivers by vehicle type matching the booking's cat_title
    // This ensures only drivers with matching vehicle types are notified that booking is available again
    // Handles both Dutch ("Standaard", "Luxe") and English ("Standard", "Luxury") variations
    const filteredOtherDrivers = await filterDriversByVehicleType(otherDrivers, booking.cat_title);

    // Send FCM push notifications to filtered other drivers (booking is still available)
    if (filteredOtherDrivers.length > 0) {
      const allTokens = filteredOtherDrivers.flatMap((driver) => driver.fcmTokens || []);
      
      if (allTokens.length > 0) {
        await sendToDrivers(
          filteredOtherDrivers.map((d) => d._id.toString()),
          {
            title: "Booking Available Again! 🔄",
            body: `Booking from ${booking.from_location} to ${booking.to_location} is available again`,
          },
          {
            event: events.BOOKING_REJECTED,
            ...bookingData,
            rejectedBy: driverId.toString(),
          }
        );
      } else {
      }
    }

    // If booking was admin-assigned, notify admin via Ably with full booking data
    if (booking.assignmentType === "admin") {
      const admins = await Admin.find({ active: true }).select("_id email name").lean();
      const adminIds = admins.map((a) => a._id.toString());
      const fullBookingData = normalizeBookingForLiveUpdate(booking);
      
      if (adminIds.length > 0 && fullBookingData) {
        publishToChannel(channels.ADMIN, events.BOOKING_REJECTED_ADMIN, {
          ...fullBookingData,
          stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
          stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) ? booking.stopsCoordinates : (fullBookingData.stopsCoordinates || []), // Ensure stopsCoordinates array is included
          pickupCoordinates: booking.pickupCoordinates || fullBookingData.pickupCoordinates, // Ensure pickup coordinates are included
          dropoffCoordinates: booking.dropoffCoordinates || fullBookingData.dropoffCoordinates, // Ensure dropoff coordinates are included
          rejectedBy: driverId.toString(),
          rejectionReason: booking.rejectionReason || "No reason provided",
          timestamp: new Date().toISOString(),
          adminIds,
          message: `Driver rejected the admin-assigned booking from ${booking.from_location} to ${booking.to_location}`,
          assignmentType: "admin",
        }).then(() => {
        }).catch((ablyError) => {
        });
      }
    } else {
    }

    // PHASE 2 FIX: Remove booking from rejecting driver's view based on booking type
    const assignmentType = booking.assignmentType || booking.assignment_type;
    const driverChannelName = channels.DRIVER(driverId.toString());
    const bookingId = booking._id?.toString() || booking.id || bookingData.bookingId;
    
    if (assignmentType === "auto" && bookingId) {
      // PHASE 2: Auto-assigned booking rejection - remove from rejecting driver's LIVE view only
      // Other drivers should still see it in LIVE (booking is still available)
      const liveBookingRemovedData = {
        bookingId: bookingId,
        action: "removed",
        reason: "driver_rejected",
        timestamp: new Date().toISOString(),
      };
      
      // Send to rejecting driver's specific channel only (not broadcast to all)
      publishToChannel(driverChannelName, events.LIVE_BOOKING_REMOVED, liveBookingRemovedData)
        .then(() => {
          logger.info(`[REALTIME] Sent LIVE_BOOKING_REMOVED to rejecting driver ${driverId} for booking ${bookingId} (auto-assigned)`);
        })
        .catch((ablyError) => {
          logAblyError(`notifyBookingRejected:driver-${driverId}`, ablyError);
        });
      
      // PHASE 2: The BOOKING_REJECTED event above already notifies other drivers that booking is still available
      // No need to send LIVE_BOOKING_REMOVED to all drivers - booking stays in LIVE for others
    } else if (assignmentType === "admin" && bookingId) {
      // Admin-assigned booking rejection - remove from ASSIGNED API in real-time
      const assignedBookingRemovedData = {
        bookingId: bookingId,
        driverId: driverId.toString(),
        action: "removed",
        reason: "driver_rejected",
        timestamp: new Date().toISOString(),
      };
      
      // Send assigned-booking-removed event to rejecting driver (removes from their assigned list)
      publishToChannel(driverChannelName, events.ASSIGNED_BOOKING_REMOVED, assignedBookingRemovedData)
        .then(() => {
          logger.info(`[REALTIME] ✅ Sent ASSIGNED_BOOKING_REMOVED to rejecting driver ${driverId} for booking ${bookingId} (admin-assigned)`);
        })
        .catch((ablyError) => {
          logAblyError(`notifyBookingRejected:assigned-removed-driver-${driverId}`, ablyError);
        });
      
      // Also send to drivers broadcast channel for compatibility
      publishToChannel(channels.DRIVERS, events.ASSIGNED_BOOKING_REMOVED, assignedBookingRemovedData)
        .then(() => {
          logger.info(`[REALTIME] ✅ Sent ASSIGNED_BOOKING_REMOVED broadcast for booking ${bookingId} (admin-assigned rejected)`);
        })
        .catch((ablyError) => {
          logAblyError(`notifyBookingRejected:assigned-removed-broadcast`, ablyError);
        });
    }

  } catch (error) {
    logAblyError("notifyBookingRejected", error);
  }
};

/**
 * Notify all online drivers that a booking has expired (remove from their list)
 * @param {Object} booking - Booking object
 */
const notifyBookingExpired = async (booking) => {
  try {
    
    const bookingData = normalizeBookingForNotification(booking);
    
    // Get all online drivers (optimized single query)
    const { onlineDriverIds } = await getOnlineDrivers();

    // Send Ably real-time event to remove booking from drivers' lists
    // Fire-and-forget: don't await, just log errors
    if (onlineDriverIds.length > 0) {
      publishToChannel(channels.DRIVERS, events.BOOKING_EXPIRED, {
        bookingId: bookingData.bookingId,
        timestamp: new Date().toISOString(),
        onlineDriverIds,
      }).then(() => {
      }).catch((ablyError) => {
      });
    }

  } catch (error) {
  }
};

/**
 * Notify admin that a booking has expired and needs manual assignment
 * @param {Object} booking - Booking object
 */
const notifyAdminBookingExpired = async (booking) => {
  try {
    const bookingData = normalizeBookingForNotification(booking);

    // Get all admin users
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }

    const adminIds = admins.map((a) => a._id.toString());
    const now = new Date();
    const bookingDateTime = booking.date_time ? new Date(booking.date_time).toLocaleString() : "N/A";
    const price = parseFloat(String(booking.price || "0").replace(/[^\d.-]/g, "")) || 0;

    // Prepare detailed notification message
    const notificationMessage = `Booking expired after 5 minutes without driver acceptance.`;
    const detailedMessage = `
Booking Details:
- Customer: ${booking.user_name} (${booking.email})
- From: ${booking.from_location}
- To: ${booking.to_location}
- Price: €${price.toFixed(2)}
- Date & Time: ${bookingDateTime}
- Booking ID: ${bookingData.bookingId}

This booking requires manual assignment. Please assign a driver through the admin dashboard.
    `.trim();

    // Create notification in database for each admin
    const notificationPromises = admins.map(async (admin) => {
      try {
        const notification = await createNotification({
          type: "booking-expired",
          title: `Booking Expired - Manual Assignment Required`,
          message: `Booking from ${booking.from_location} to ${booking.to_location} expired after 5 minutes. No driver accepted.`,
          bookingId: booking._id,
          bookingDetails: {
            from_location: booking.from_location,
            to_location: booking.to_location,
            price: booking.price,
            user_name: booking.user_name,
            email: booking.email,
          },
          priority: "high",
          data: {
            bookingId: bookingData.bookingId,
            from_location: booking.from_location,
            to_location: booking.to_location,
            price: price.toFixed(2),
            date_time: bookingDateTime,
          },
        });
        return notification;
      } catch (notifError) {
        return null;
      }
    });

    await Promise.allSettled(notificationPromises);

    // Send Ably real-time event to admin channel (for dashboard updates)
    // Fire-and-forget: don't await, just log errors
    publishToChannel(channels.ADMIN, events.BOOKING_EXPIRED_ADMIN, {
      ...bookingData,
      timestamp: now.toISOString(),
      adminIds,
      message: notificationMessage,
      detailedMessage: detailedMessage,
      priority: "high",
      requiresAction: true,
      actionType: "assign_driver",
      bookingUrl: `/bookings/${bookingData.bookingId}`,
    }).then(() => {
    }).catch((ablyError) => {
    });

    // Note: Email notifications removed as per requirement - using dashboard notifications only

    // Note: Admin push notifications would require FCM tokens in admin model
    // For now, we rely on Ably (real-time dashboard) and Email (persistent notification)
    // If admin model has FCM tokens in the future, add push notification here

  } catch (error) {
    if (error.stack) {
    }
  }
};

/**
 * Notify admin when a booking is created (for all bookings, regardless of price)
 * @param {Object} booking - Booking object
 */
const notifyAdminBookingCreated = async (booking) => {
  try {
    const bookingData = normalizeBookingForNotification(booking);
    
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }

    const adminIds = admins.map((a) => a._id.toString());
    
    // Use full booking data for live updates (same format as live-booking-added)
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    // Send Ably real-time event to admin channel for new booking notification
    // Fire-and-forget Ably publish (don't await to avoid blocking)
    publishToChannel(channels.ADMIN, events.BOOKING_CREATED_ADMIN, {
      // Include both normalized and full booking data for compatibility
      ...bookingData,
      ...(fullBookingData && { 
        // Include full booking data for direct cache updates
        id: fullBookingData.id,
        bookingId: fullBookingData.id,
        from_location: fullBookingData.from_location,
        to_location: fullBookingData.to_location,
        date_time: fullBookingData.date_time,
        status: fullBookingData.status,
        price: fullBookingData.price,
        assignmentType: fullBookingData.assignmentType,
        isExpired: booking.isExpired || false,
      }),
      // Explicitly include stops as array of strings (ensures it's always in the payload)
      stops: booking.stops && Array.isArray(booking.stops) 
        ? booking.stops 
        : (fullBookingData?.stops || bookingData.stops || []),
      stopsCoordinates: booking.stopsCoordinates && Array.isArray(booking.stopsCoordinates) 
        ? booking.stopsCoordinates 
        : (fullBookingData?.stopsCoordinates || []),
      pickupCoordinates: booking.pickupCoordinates || fullBookingData?.pickupCoordinates, // Ensure pickup coordinates are included
      dropoffCoordinates: booking.dropoffCoordinates || fullBookingData?.dropoffCoordinates, // Ensure dropoff coordinates are included
      timestamp: new Date().toISOString(),
      adminIds,
      message: `New booking created: ${booking.from_location} → ${booking.to_location}`,
      assignmentType: booking.assignmentType,
      price: booking.price,
    }).then(() => {
    }).catch((ablyError) => {
    });
    
    
    // Note: LIVE_BOOKING_ADDED event is sent separately via notifyLiveBookingAdded()
    // to ensure it includes full booking data for real-time list updates
    
  } catch (error) {
  }
};

/**
 * Notify all clients (admin and driver) about a new live booking
 * @param {Object} booking - Booking object
 */
const notifyLiveBookingAdded = async (booking) => {
  try {
    // Use full booking data for live updates so frontend can update without refetching
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    if (!fullBookingData) {
      return;
    }
    
    
    // Send to both admin and driver channels with full booking data
    const promises = [
      publishToChannel(channels.ADMIN, events.LIVE_BOOKING_ADDED, {
        booking: fullBookingData, // Full booking object for frontend to use directly
        action: "added", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingAdded:admin", err);
      }),
      publishToChannel(channels.DRIVERS, events.LIVE_BOOKING_ADDED, {
        booking: fullBookingData, // Full booking object for frontend to use directly
        action: "added", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingAdded:drivers", err);
      }),
    ];
    
    await Promise.allSettled(promises);
  } catch (error) {
    logAblyError("notifyLiveBookingAdded", error);
  }
};

/**
 * Notify all clients (admin and driver) that a booking was removed from live bookings
 * @param {Object} booking - Booking object
 */
const notifyLiveBookingRemoved = async (booking) => {
  try {
    const bookingId = booking._id?.toString() || booking.id || booking.bookingId;
    
    if (!bookingId) {
      return;
    }
    
    // Send to both admin and driver channels
    const promises = [
      publishToChannel(channels.ADMIN, events.LIVE_BOOKING_REMOVED, {
        bookingId: bookingId,
        action: "removed", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingRemoved:admin", err);
      }),
      publishToChannel(channels.DRIVERS, events.LIVE_BOOKING_REMOVED, {
        bookingId: bookingId,
        action: "removed", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingRemoved:drivers", err);
      }),
    ];
    
    await Promise.allSettled(promises);
  } catch (error) {
    logAblyError("notifyLiveBookingRemoved", error);
  }
};

/**
 * Notify all clients (admin and driver) that a live booking was updated
 * @param {Object} booking - Booking object
 */
const notifyLiveBookingUpdated = async (booking) => {
  try {
    // Use full booking data for live updates so frontend can update without refetching
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    if (!fullBookingData) {
      return;
    }
    
    // Send to both admin and driver channels with full booking data
    const promises = [
      publishToChannel(channels.ADMIN, events.LIVE_BOOKING_UPDATED, {
        booking: fullBookingData, // Full booking object for frontend to use directly
        action: "updated", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingUpdated:admin", err);
      }),
      publishToChannel(channels.DRIVERS, events.LIVE_BOOKING_UPDATED, {
        booking: fullBookingData, // Full booking object for frontend to use directly
        action: "updated", // Action type for frontend
        timestamp: new Date().toISOString(),
      }).catch((err) => {
        logAblyError("notifyLiveBookingUpdated:drivers", err);
      }),
    ];
    
    await Promise.allSettled(promises);
  } catch (error) {
    logAblyError("notifyLiveBookingUpdated", error);
  }
};

/**
 * Notify admin when a booking is completed with driver information
 * This sends a real-time notification to admin dashboard with complete booking and driver details
 * @param {Object} booking - Booking object (should be populated with driverId)
 * @param {String} driverId - ID of driver who completed the booking
 */
const notifyAdminBookingCompleted = async (booking, driverId) => {
  try {
    const fullBookingData = normalizeBookingForLiveUpdate(booking);
    
    if (!fullBookingData) {
      return;
    }
    
    // Get all active admin users
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }
    
    const adminIds = admins.map((a) => a._id.toString());
    
    // Fetch driver details to include in notification
    let driverDetails = null;
    if (driverId) {
      try {
        const driver = await Driver.findById(driverId)
          .select("_id firstName lastName email phone profilePicture isOnline")
          .lean();
        
        if (driver) {
          driverDetails = {
            id: driver._id.toString(),
            name: driver.firstName && driver.lastName 
              ? `${driver.firstName} ${driver.lastName}` 
              : driver.firstName || driver.lastName || "Unknown Driver",
            firstName: driver.firstName || "",
            lastName: driver.lastName || "",
            email: driver.email || "",
            phone: driver.phone || "",
            profilePicture: driver.profilePicture || null,
            isOnline: driver.isOnline || false,
          };
        } else {
        }
      } catch (driverError) {
        // Continue without driver details rather than failing the entire notification
      }
    }
    
    // Prepare notification message
    const driverInfo = driverDetails 
      ? `${driverDetails.name} (${driverDetails.phone || 'N/A'})`
      : "Driver information unavailable";
    
    const notificationMessage = `Booking completed by ${driverInfo}`;
    const detailedMessage = `Booking from ${booking.from_location} to ${booking.to_location} has been completed successfully.`;
    
    // Prepare admin notification data with driver information
    const adminNotificationData = {
      ...fullBookingData,
      stops: booking.stops && Array.isArray(booking.stops) ? booking.stops : (fullBookingData.stops || []), // Ensure stops array is included
      status: "completed",
      driverId: driverId ? driverId.toString() : null,
      driver: driverDetails, // Include full driver details
      message: notificationMessage,
      detailedMessage: detailedMessage,
      timestamp: new Date().toISOString(),
      adminIds,
      completedAt: booking.completedAt instanceof Date
        ? booking.completedAt.toISOString()
        : booking.completedAt,
    };
    
    // Send Ably real-time event to admin channel
    
    publishToChannel(channels.ADMIN, events.BOOKING_COMPLETED, adminNotificationData)
      .then(() => {
        if (driverDetails) {
        }
      })
      .catch((ablyError) => {
      });
    
    // Create notification in database for each admin
    const notificationPromises = admins.map(async (admin) => {
      try {
        const notification = await createNotification({
          type: "booking-completed",
          title: `Booking Completed`,
          message: `Booking from ${booking.from_location} to ${booking.to_location} has been completed by ${driverInfo}.`,
          bookingId: booking._id,
          bookingDetails: {
            from_location: booking.from_location,
            to_location: booking.to_location,
            price: booking.price,
            user_name: booking.user_name,
            email: booking.email,
            completedAt: booking.completedAt instanceof Date
              ? booking.completedAt.toISOString()
              : booking.completedAt,
          },
          priority: "medium",
          data: {
            bookingId: fullBookingData.id,
            from_location: booking.from_location,
            to_location: booking.to_location,
            price: booking.price,
            driverId: driverId ? driverId.toString() : null,
            driverDetails: driverDetails ? {
              id: driverDetails.id,
              name: driverDetails.name,
              phone: driverDetails.phone,
              email: driverDetails.email,
              firstName: driverDetails.firstName,
              lastName: driverDetails.lastName,
              profilePicture: driverDetails.profilePicture,
              isOnline: driverDetails.isOnline,
            } : null,
            driverName: driverDetails ? driverDetails.name : null,
            driverPhone: driverDetails ? driverDetails.phone : null,
            completedAt: booking.completedAt instanceof Date
              ? booking.completedAt.toISOString()
              : booking.completedAt,
          },
        });
        return notification;
      } catch (notifError) {
        return null;
      }
    });
    
    await Promise.allSettled(notificationPromises);
    
  } catch (error) {
    if (error.stack) {
    }
  }
};

module.exports = {
  notifyNewBooking,
  notifyAllDriversNewBooking,
  notifyAdminBookingCreated,
  notifyBookingAccepted,
  notifyBookingAssigned,
  notifyBookingUnassigned,
  notifyBookingStatusUpdate,
  notifyBookingRejected,
  notifyBookingExpired,
  notifyAdminBookingExpired,
  notifyAdminBookingCompleted,
  notifyLiveBookingAdded,
  notifyLiveBookingRemoved,
  notifyLiveBookingUpdated,
  getOnlineDrivers,
  getOnlineDriversWithTokens, // Keep for backward compatibility
  invalidateOnlineDriversCache,
};

