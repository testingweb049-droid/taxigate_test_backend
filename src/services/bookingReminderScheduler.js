const Booking = require("../models/booking.model");
const Driver = require("../models/driver.model");
const { sendToDriver } = require("./pushNotification");
const { publishToChannel } = require("../../config/ably");
const { channels, events } = require("../utils/notificationEvents");
const logger = require("../utils/logger");

// In-memory map of bookingId -> timeout
const reminderTimers = new Map();

/**
 * Clear reminder timer for a booking
 * @param {string} bookingId - Booking ID
 */
const clearReminderTimer = (bookingId) => {
  const timer = reminderTimers.get(bookingId);
  if (timer) {
    clearTimeout(timer);
    reminderTimers.delete(bookingId);
    logger.debug?.(`[REMINDER] Cleared reminder timer for booking ${bookingId}`);
  }
};

/**
 * Schedule a 30-minute reminder notification for a booking
 * Schedules reminder 30 minutes before booking time for any future booking
 * @param {Object} booking - Booking object with driverId and date_time
 */
const scheduleBookingReminder = (booking) => {
  try {
    const bookingId = booking._id?.toString();
    if (!bookingId || !booking.driverId) {
      return;
    }

    const bookingDateTime = booking.date_time instanceof Date 
      ? booking.date_time 
      : new Date(booking.date_time);
    
    const now = new Date();
    const thirtyMinutesBefore = new Date(bookingDateTime.getTime() - 30 * 60 * 1000); // 30 minutes before
    const delay = thirtyMinutesBefore - now;

    // Only schedule if:
    // 1. Booking is in the future
    // 2. 30 minutes before booking is in the future (so we can schedule the reminder)
    if (delay <= 0 || bookingDateTime <= now) {
      // Booking is in the past or reminder time has already passed
      logger.debug(`[REMINDER] Skipping reminder for booking ${bookingId} - booking is in the past or reminder time has passed`);
      return;
    }

    // Clear any existing timer for this booking
    clearReminderTimer(bookingId);

    // Schedule the reminder
    const timer = setTimeout(() => sendReminderNow(bookingId), delay);
    reminderTimers.set(bookingId, timer);
    
    const delayMinutes = Math.round(delay / (1000 * 60));
    const delayHours = Math.round(delayMinutes / 60);
    const delayDays = Math.round(delayHours / 24);
    
    let delayText = "";
    if (delayDays > 0) {
      delayText = `${delayDays} day(s) and ${delayHours % 24} hour(s)`;
    } else if (delayHours > 0) {
      delayText = `${delayHours} hour(s) and ${delayMinutes % 60} minute(s)`;
    } else {
      delayText = `${delayMinutes} minute(s)`;
    }
    
    logger.info(`[REMINDER] Scheduled 30-minute reminder for booking ${bookingId} in ${delayText} (reminder will fire at ${thirtyMinutesBefore.toISOString()})`);
  } catch (err) {
    logger.error(`[REMINDER] Failed to schedule reminder: ${err.message}`);
  }
};

/**
 * Send reminder notification immediately
 * @param {string} bookingId - Booking ID
 */
const sendReminderNow = async (bookingId) => {
  try {
    clearReminderTimer(bookingId);

    // Fetch the booking with driver info
    const booking = await Booking.findById(bookingId)
      .populate("driverId", "firstName lastName email phone fcmTokens")
      .lean();

    if (!booking || !booking.driverId) {
      logger.warn(`[REMINDER] Booking ${bookingId} not found or has no driver`);
      return;
    }

    const driver = booking.driverId;
    const driverId = driver._id?.toString() || driver.id;

    // Format booking date/time for display
    const bookingDateTime = booking.date_time instanceof Date 
      ? booking.date_time 
      : new Date(booking.date_time);
    
    const formattedDateTime = bookingDateTime.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    // Prepare notification message
    const notificationTitle = "Booking Reminder ⏰";
    const notificationBody = `Your booking from ${booking.from_location} to ${booking.to_location} is in 30 minutes (${formattedDateTime})`;

    // Send push notification to driver
    try {
      await sendToDriver(
        driverId,
        {
          title: notificationTitle,
          body: notificationBody,
        },
        {
          type: "booking-reminder",
          bookingId: bookingId,
          from_location: booking.from_location,
          to_location: booking.to_location,
          date_time: bookingDateTime.toISOString(),
        }
      );
      logger.info(`[REMINDER] Push notification sent to driver ${driverId} for booking ${bookingId}`);
    } catch (pushError) {
      logger.error(`[REMINDER] Failed to send push notification: ${pushError.message}`);
    }

    // Send real-time notification via Ably
    try {
      await publishToChannel(
        channels.DRIVER(driverId),
        events.BOOKING_REMINDER,
        {
          booking: {
            id: bookingId,
            from_location: booking.from_location,
            to_location: booking.to_location,
            date_time: bookingDateTime.toISOString(),
            cat_title: booking.cat_title,
            num_passengers: booking.num_passengers,
            luggage: booking.luggage,
            distance: booking.distance,
            price: booking.price,
            actualPrice: booking.actualPrice,
          },
          driverId: driverId,
          reminderTime: new Date().toISOString(),
          message: notificationBody,
        }
      );
      logger.info(`[REMINDER] Real-time notification sent to driver ${driverId} for booking ${bookingId}`);
    } catch (ablyError) {
      logger.error(`[REMINDER] Failed to send real-time notification: ${ablyError.message}`);
    }

    logger.info(`[REMINDER] Reminder sent for booking ${bookingId} to driver ${driverId}`);
  } catch (err) {
    logger.error(`[REMINDER] Error sending reminder for booking ${bookingId}: ${err.message}`);
  }
};

module.exports = {
  scheduleBookingReminder,
  clearReminderTimer,
};
