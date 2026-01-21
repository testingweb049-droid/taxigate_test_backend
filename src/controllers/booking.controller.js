const Booking = require("../models/booking.model");
const Vehicle = require("../models/vehicle.model");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse } = require("../utils/response");
const { handleNotification, toBookingResponse, handleServiceError } = require("../utils/booking.utils");
const sendEmail = require("../utils/email");
const bookingConfirmationEmail = require("../templates/emails/bookingConfirmationEmail");
const adminBookingNotificationEmail = require("../templates/emails/adminBookingNotificationEmail");
const { createPaymentSessionForBooking } = require("../services/payment.service");
const mongoose = require("mongoose");
const {
  createBooking: createBookingService,
  getBookingStatus: getBookingStatusService,
  assignDriverToBooking: assignDriverToBookingService,
  unassignDriver: unassignDriverService,
  viewPendingLongDistanceBookings: viewPendingLongDistanceBookingsService,
  getAllPendingBookings: getAllPendingBookingsService,
  viewHighPriceBookings: viewHighPriceBookingsService,
  viewLowPriceBookings: viewLowPriceBookingsService,
  getAllBookings: getAllBookingsService,
  getAvailableBookings: getAvailableBookingsService,
  acceptBooking: acceptBookingService,
  rejectBooking: rejectBookingService,
  getUpcomingBookings: getUpcomingBookingsService,
  getDriverCompletedBookings: getDriverCompletedBookingsService,
  startBooking: startBookingService,
  getActiveBooking: getActiveBookingService,
  pickupBooking: pickupBookingService,
  dropoffBooking: dropoffBookingService,
  completeBooking: completeBookingService,
  viewAdminAssignedBookings: viewAdminAssignedBookingsService,
  getAllAssignedBookings: getAllAssignedBookingsService,
  getExpiredBookings: getExpiredBookingsService,
  getLiveBookings: getLiveBookingsService,
  getAdminCompletedBookings: getAdminCompletedBookingsService,
  getBookingByOrderNumber: getBookingByOrderNumberService,
  deleteBooking: deleteBookingService,
} = require("../services/booking.service");
const {
  scheduleBookingExpiry,
  clearExpiryTimer,
} = require("../services/bookingExpiryScheduler");
const {
  scheduleBookingReminder,
  clearReminderTimer,
} = require("../services/bookingReminderScheduler");
const {
  notifyNewBooking,
  notifyAllDriversNewBooking,
  notifyAdminBookingCreated,
  notifyBookingAccepted,
  notifyBookingAssigned,
  notifyBookingUnassigned,
  notifyBookingStatusUpdate,
  notifyBookingRejected,
  notifyAdminBookingCompleted,
  notifyLiveBookingAdded,
  notifyLiveBookingRemoved,
  notifyLiveBookingUpdated,
} = require("../services/bookingNotifications");

// ===== USER CONTROLLERS =====

exports.createBooking = catchAsync(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payload = {
      from_location: req.body.from_location,
      to_location: req.body.to_location,
      date_time: new Date(req.body.date_time),
      return_date_time: req.body.return_date_time
        ? new Date(req.body.return_date_time)
        : undefined,
      cat_title: req.body.cat_title,
      actualPrice: String(req.body.price),
      user_name: req.body.user_name,
      email: req.body.email.toLowerCase(),
      num_passengers: req.body.num_passengers || 1,
      luggage: req.body.luggage,
      number: req.body.number,
      note_description: req.body.note_description,
      pickup_house_no: req.body.pickup_house_no,
      dropoff_house_no: req.body.dropoff_house_no,
      stops: req.body.stops && Array.isArray(req.body.stops)
        ? req.body.stops.filter(stop => stop && stop.trim()) 
        : [],
      stopsCoordinates: req.body.stopsCoordinates && Array.isArray(req.body.stopsCoordinates)
        ? req.body.stopsCoordinates.filter(coord => coord && coord.lat && coord.lng) 
        : [],
      flight_no: req.body.flight_no,
      distance: req.body.distance,
      pickupCoordinates: req.body.pickupCoordinates,
      dropoffCoordinates: req.body.dropoffCoordinates,
      isPaid: false,
    };
    const booking = await createBookingService(payload);
    const frontendUrl = process.env.CLIENT_URL
    const paymentAmount = parseFloat(String(payload.actualPrice || payload.price || "0").replace(/[^\d.-]/g, "")) || 0;
    let paymentSessionUrl = null;
    try {
      const paymentResult = await createPaymentSessionForBooking(
        booking._id,
        paymentAmount,
        payload.email,
        frontendUrl
      );
      paymentSessionUrl = paymentResult.sessionUrl;
    } catch (paymentError) {
      await session.abortTransaction();
      session.endSession();
      throw new Error(`Failed to create payment session: ${paymentError.message}`);
    }

    await session.commitTransaction();
    session.endSession();
    return successResponse(
      res,
      { 
        booking: toBookingResponse(booking),
        paymentSessionUrl: paymentSessionUrl
      },
      "Booking created successfully",
      201
    );
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("createBooking error:", err);
    return handleServiceError(res, err);
  }
});



exports.sendBookingNotifications = catchAsync(async (req, res) => {
  const startTime = Date.now();
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return errorResponse(res, "Booking not found", 404);
    }
    const actualPriceNumber = parseFloat(String(booking.actualPrice || booking.price || "0").replace(/[^\d.-]/g, "")) || 0;
    const isAutoAssigned = actualPriceNumber <= 150 && booking.assignmentType === "auto";

    try {
      if (booking.email) {
        try {
          const customerEmailHtml = bookingConfirmationEmail(booking);
          await sendEmail({
            email: booking.email,
            subject: `Booking Confirmation`,
            html: customerEmailHtml,
            text: `Booking Confirmation - Your booking has been confirmed.`,
          });
        } catch (customerEmailError) {
          console.error(`[BOOKING] Failed to send email to customer ${booking.email}:`, {
            message: customerEmailError.message,
            code: customerEmailError.code,
            stack: customerEmailError.stack,
          });
        }
      }
      
      const adminHtml = adminBookingNotificationEmail(booking);
      const adminEmail = process.env.EMAIL_USERNAME;

      if (!adminEmail) {
        console.error(`[BOOKING] EMAIL_USERNAME environment variable is not set. Cannot send admin notification email.`);
      } else {
        try {
          await sendEmail({
            email: adminEmail,
            subject: `New Booking Created`,
            html: adminHtml,
          });
        } catch (adminEmailError) {
          console.error(`[BOOKING] Failed to send email to admin ${adminEmail}:`, {
            message: adminEmailError.message,
            code: adminEmailError.code,
            response: adminEmailError.response,
            stack: adminEmailError.stack,
          });
        }
      }
    } catch (emailError) {
      console.error(`[BOOKING] Error in email sending process:`, {
        message: emailError.message,
        stack: emailError.stack,
      });
    }

    if (isAutoAssigned) {
      try {
        const fcmResult = await notifyAllDriversNewBooking(booking);
      } catch (fcmError) {
        console.error(`[BOOKING] Failed to send push notifications to drivers:`, {
          message: fcmError.message,
          code: fcmError.code,
          stack: fcmError.stack,
        });
      }
    }

    scheduleBookingExpiry(booking);

    try {
      const logger = require("../utils/logger");
      
      try {
        await notifyAdminBookingCreated(booking);
      } catch (adminNotifError) {
        if (adminNotifError.stack) {
          console.error(`[BOOKING] Failed to notify admin:`, adminNotifError.stack);
        }
      }

      if (isAutoAssigned) {
        try {
          await notifyNewBooking(booking);
        } catch (notificationError) {
          if (notificationError.stack) {
            console.error(`[BOOKING] Failed to notify drivers:`, notificationError.stack);
          }
        }
      }

      if (isAutoAssigned && booking.status === "pending" && !booking.isExpired) {
        try {
          await notifyLiveBookingAdded(booking);
          logger.info(`[REALTIME] Added auto-assigned booking ${booking._id} to LIVE API`);
        } catch (liveError) {
          if (liveError.stack) {
            console.error(`[BOOKING] Failed to add to live bookings:`, liveError.stack);
          }
        }
      } else if (actualPriceNumber > 150) {
        logger.info(`[REALTIME] Admin-assigned booking ${booking._id} - skipping LIVE API (will be in ASSIGNED API when admin assigns)`);
      }
    } catch (globalError) {
      if (globalError.code) {
        console.error(`[BOOKING] Notification error code:`, globalError.code);
      }
      if (globalError.stack) {
        console.error(`[BOOKING] Global notification error:`, globalError.stack);
      }
    }

    booking.notificationsSentAt = new Date();
    await booking.save();

    const endTime = Date.now();
    const executionTime = ((endTime - startTime) / 1000).toFixed(3);
    console.log(`[BOOKING] Booking notifications sent successfully in ${executionTime}s (Booking ID: ${bookingId})`);

    return successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Notifications sent successfully",
      200
    );
  } catch (err) {
    console.error("sendBookingNotifications error:", err);
    return handleServiceError(res, err);
  }
});

exports.getBookingStatus = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return errorResponse(res, "Booking not found", 404);
    }
    // Return full booking details using toBookingResponse helper
    return successResponse(res, { booking: toBookingResponse(booking) }, "Booking status fetched");
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getBookingByOrderNumber = catchAsync(async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const booking = await getBookingByOrderNumberService(orderNumber);
    return successResponse(res, { booking: toBookingResponse(booking) }, "Booking fetched successfully");
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.assignDriverToBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { driverId } = req.body;
    const bookingBeforeUpdate = await Booking.findById(bookingId).lean();
    const booking = await assignDriverToBookingService(bookingId, driverId);
    const wasExpired = bookingBeforeUpdate?.isExpired === true;

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Driver assigned to booking successfully"
    );

    // Send notifications in background (non-blocking)
    // Use setImmediate to ensure response is sent first, then process notifications
    setImmediate(async () => {
      try {

        // Send real-time notifications to assigned driver (don't use handleNotification to avoid delays)
        // notifyBookingAssigned handles its own error handling and fire-and-forget for push notifications
        try {
          await notifyBookingAssigned(booking, driverId);
        } catch (notifError) {
          // Log error but don't fail - notifications are non-critical
          const logger = require("../utils/logger");
          logger.error(`[NOTIFICATION] Failed to send booking assignment notification: ${notifError?.message || notifError}`);
        }

        // CRITICAL FIX: Admin-assigned bookings should NEVER be in LIVE API
        // Only auto-assigned bookings (assignmentType === "auto") appear in LIVE API
        // When admin assigns a booking, it should be REMOVED from LIVE API if it was there
        // and only appear in ASSIGNED API for the assigned driver

        // Check if this is an admin-assigned booking
        const isAdminAssigned = booking.assignmentType === "admin";

        if (isAdminAssigned) {
          // Admin-assigned booking - REMOVE from LIVE API (if it was there) and add to ASSIGNED API only
          const bookingId = booking._id?.toString() || booking.id;

          // Remove from LIVE API for all drivers/admin (if it was an auto-assigned booking that got admin-assigned)
          try {
            await notifyLiveBookingRemoved(booking);
            logger.info(`[REALTIME] Removed admin-assigned booking ${bookingId} from LIVE API`);
          } catch (removeError) {
            // Non-critical - booking might not have been in LIVE API
          }

          // Do NOT add to LIVE API - admin-assigned bookings only go to ASSIGNED API
          logger.info(`[REALTIME] Admin-assigned booking ${bookingId} - only in ASSIGNED API, NOT in LIVE API`);
        } else {
          // Auto-assigned booking - can appear in LIVE API
          // If booking was previously expired and is now pending again, re-add to live bookings
          try {
            if (wasExpired && booking.status === "pending" && booking.isExpired !== true) {
              await notifyLiveBookingAdded(booking);
            }
          } catch (reactivateError) {
          }

          // Update live bookings (booking is still pending but now has driver assigned)
          if (booking.status === "pending") {
            try {
              await notifyLiveBookingUpdated(booking);
            } catch (liveError) {
              // Non-critical, continue
            }
          }
        }

      } catch (globalError) {
        if (globalError.stack) {
        }
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.unassignDriver = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;

    // Get booking before unassigning to capture driverId
    const bookingBeforeUnassign = await Booking.findById(bookingId);
    if (!bookingBeforeUnassign || !bookingBeforeUnassign.driverId) {
      // If no driver assigned, just proceed with unassign (will throw error in service)
      const booking = await unassignDriverService(bookingId);
      return successResponse(
        res,
        { booking: toBookingResponse(booking) },
        "Driver unassigned from booking successfully"
      );
    }

    const driverId = bookingBeforeUnassign.driverId.toString();
    const booking = await unassignDriverService(bookingId);

    // Notify the unassigned driver
    try {
      await handleNotification(notifyBookingUnassigned(bookingBeforeUnassign, driverId));
    } catch (notificationError) {
      // Continue - driver is already unassigned
    }

    // Update live bookings if booking is still pending
    if (booking.status === "pending" && !booking.isExpired) {
      try {
        await notifyLiveBookingUpdated(booking);
      } catch (liveError) {
        // Non-critical, continue
      }
    }

    return successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Driver unassigned from booking successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.viewPendingLongDistanceBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await viewPendingLongDistanceBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "Pending long-distance bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getAllPendingBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await getAllPendingBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "All pending bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.viewAdminAssignedBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await viewAdminAssignedBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "Admin-assigned bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.viewHighPriceBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await viewHighPriceBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "High price bookings (above 150) fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.viewLowPriceBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await viewLowPriceBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "Low price bookings (150 and below) fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getExpiredBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await getExpiredBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "Expired bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getAllBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await getAllBookingsService(page, limit);
    return successResponse(
      res,
      {
        bookings: result.bookings.map(toBookingResponse),
        pagination: result.pagination,
      },
      "All bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getAvailableBookings = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id; // Works for both driver and admin
    const userRole = req.user.role; // Get user role

    // Only pass driverId if user is a driver (not admin)
    const driverId = userRole === "driver" ? userId : null;
    const bookings = await getAvailableBookingsService(driverId);
    return successResponse(
      res,
      { bookings: bookings.map(toBookingResponse) },
      "Available bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getLiveBookings = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id; // Works for both driver and admin
    const userRole = req.user.role; // Get user role

    // Only pass driverId if user is a driver (not admin)
    const driverId = userRole === "driver" ? userId : null;
    const bookings = await getLiveBookingsService(driverId);
    return successResponse(
      res,
      { bookings: bookings.map(toBookingResponse) },
      "Live bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.acceptBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const booking = await acceptBookingService(bookingId, driverId);

    // Clear expiry timer when booking is accepted
    clearExpiryTimer(bookingId);

    // Schedule 30-minute reminder if booking is in the future and within 48 hours
    // This will send push notification and real-time notification 30 minutes before booking time
    try {
      scheduleBookingReminder(booking);
    } catch (reminderError) {
      console.error(`[BOOKING] Failed to schedule reminder for booking ${bookingId}:`, reminderError.message);
      // Don't throw - reminder scheduling shouldn't fail booking acceptance
    }

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking accepted successfully"
    );

    // Send notifications in background (non-blocking)
    // Use setImmediate to ensure response is sent first, then process notifications
    setImmediate(async () => {
      try {

        // Send real-time notifications to other drivers
        // This will remove the booking from their available list
        try {
          await handleNotification(notifyBookingAccepted(booking, driverId));
        } catch (notifError) {
        }

        // Send live booking removed notification (booking is no longer pending/live)
        try {
          await notifyLiveBookingRemoved(booking);
        } catch (liveError) {
          // Non-critical, continue
        }

      } catch (globalError) {
        if (globalError.stack) {
        }
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.rejectBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const { reason } = req.body;
    const booking = await rejectBookingService(bookingId, driverId, reason);

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking rejected successfully"
    );

    // Send real-time notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        // Send real-time notifications (don't use handleNotification to avoid delays)
        await notifyBookingRejected(booking, driverId);

        // If booking is still pending after rejection, update live bookings
        // If booking is rejected, remove from live bookings
        try {
          if (booking.status === "rejected") {
            await notifyLiveBookingRemoved(booking);
          } else if (booking.status === "pending") {
            await notifyLiveBookingUpdated(booking);
          }
        } catch (liveError) {
          // Non-critical, continue
        }
      } catch (notifError) {
        // Log error but don't fail - notifications are non-critical
        const logger = require("../utils/logger");
        logger.error(`[NOTIFICATION] Failed to send booking rejection notification: ${notifError?.message || notifError}`);
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.upcomingBookings = catchAsync(async (req, res) => {
  try {
    const driverId = req.user.id;
    const bookings = await getUpcomingBookingsService(driverId);
    return successResponse(
      res,
      { bookings: bookings.map(toBookingResponse) },
      "Upcoming bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.startBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const booking = await startBookingService(bookingId, driverId);

    // Safety: clear expiry timer once started
    clearExpiryTimer(bookingId);

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking started successfully"
    );

    // Send real-time notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        await notifyBookingStatusUpdate(booking, driverId, "started");
      } catch (notifError) {
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.activeBooking = catchAsync(async (req, res) => {
  try {
    const driverId = req.user.id;
    const booking = await getActiveBookingService(driverId);
    return successResponse(
      res,
      { booking: booking ? toBookingResponse(booking) : null },
      "Active booking fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.pickupBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const booking = await pickupBookingService(bookingId, driverId);

    // Safety: clear expiry timer and reminder timer once picked up
    clearExpiryTimer(bookingId);
    clearReminderTimer(bookingId);

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking marked as picked up successfully"
    );

    // Send real-time notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        await notifyBookingStatusUpdate(booking, driverId, "picked_up");
      } catch (notifError) {
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.dropoffBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const booking = await dropoffBookingService(bookingId, driverId);

    // Safety: clear expiry timer once dropped off
    clearExpiryTimer(bookingId);

    // Return response immediately - notifications run in background
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking marked as dropped off successfully"
    );

    // Send real-time notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        await notifyBookingStatusUpdate(booking, driverId, "dropped_off");
      } catch (notifError) {
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.completeBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const driverId = req.user.id;
    const booking = await completeBookingService(bookingId, driverId);
    clearExpiryTimer(bookingId);
    clearReminderTimer(bookingId);
    const response = successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking completed successfully"
    );
    setImmediate(async () => {
      try {
        try {
          await notifyAdminBookingCompleted(booking, driverId);
        } catch (adminNotifError) {
        }
        try {
          await notifyBookingStatusUpdate(booking, driverId, "completed");
        } catch (statusNotifError) {
        }

      } catch (globalError) {
        if (globalError.stack) {
        }
      }
    });

    return response;
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.completedBookings = catchAsync(async (req, res) => {
  try {
    const driverId = req.user.id;
    const bookings = await getDriverCompletedBookingsService(driverId);
    return successResponse(
      res,
      { bookings: bookings.map(toBookingResponse) },
      "Completed bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.getAllAssignedBookings = catchAsync(async (req, res) => {
  try {
    const driverId = req.user.id;
    const bookings = await getAllAssignedBookingsService(driverId);
    return successResponse(
      res,
      { bookings: bookings.map(toBookingResponse) },
      "All assigned bookings fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});


exports.getAdminCompletedBookings = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await getAdminCompletedBookingsService(page, limit);

    // Transform bookings to include driver details in response
    const bookingsWithDriver = await Promise.all(
      result.bookings.map(async (booking) => {
        const bookingResponse = toBookingResponse(booking);

        // Add driver details if driver exists
        if (booking.driverId && typeof booking.driverId === 'object') {
          // Get approved vehicles for this driver
          const approvedVehicles = await Vehicle.find({
            driver: booking.driverId._id || booking.driverId.id,
            status: "Approved",
            deletedAt: null
          }).select("type brand model color plateNumber").lean();

          bookingResponse.driver = {
            id: booking.driverId._id?.toString() || booking.driverId.id,
            firstName: booking.driverId.firstName || "",
            lastName: booking.driverId.lastName || "",
            fullName: booking.driverId.firstName && booking.driverId.lastName
              ? `${booking.driverId.firstName} ${booking.driverId.lastName}`
              : booking.driverId.firstName || booking.driverId.lastName || "Unknown Driver",
            email: booking.driverId.email || "",
            phone: booking.driverId.phone || "",
            profilePicture: booking.driverId.profilePicture || null,
            isOnline: booking.driverId.isOnline || false,
            vehicles: approvedVehicles.map(v => ({
              id: v._id.toString(),
              type: v.type,
              brand: v.brand,
              model: v.model,
              color: v.color,
              plateNumber: v.plateNumber,
            })),
          };
        } else if (booking.driverId) {
          // If driverId is just an ID (not populated), set driver as null
          bookingResponse.driver = null;
        }

        return bookingResponse;
      })
    );

    return successResponse(
      res,
      {
        bookings: bookingsWithDriver,
        pagination: result.pagination,
      },
      "Completed bookings with driver details fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

exports.deleteBooking = catchAsync(async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await deleteBookingService(bookingId);
    setImmediate(async () => {
      try {
        await notifyLiveBookingRemoved(booking);
      } catch (notifError) {
        console.error(`[NOTIFICATION] Failed to send booking deletion notification: ${notifError?.message || notifError}`);
      }
    });

    return successResponse(
      res,
      { booking: toBookingResponse(booking) },
      "Booking deleted successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});


