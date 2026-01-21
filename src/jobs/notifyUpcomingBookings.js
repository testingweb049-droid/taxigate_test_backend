// cron/notifyUpcomingBookings.js
const cron = require("node-cron");
const Booking = require("../models/booking.model");
const Driver = require("../models/driver.model");
const sendEmail = require("../utils/email");
const { publishToChannel } = require("../../config/ably");
const { channels, events } = require("../utils/notificationEvents");
const { sendToDriver } = require("../services/pushNotification");
const logger = require("../utils/logger");
const chalk = require("chalk");

/**
 * Background job to notify drivers about upcoming bookings (4 hours before)
 * Runs every hour
 */
const notifyUpcomingBookingsJob = () => {
  const schedule = "0 * * * *"; // Every hour at minute 0
  logger.info(chalk.cyan(`Cron job initialized: notifyUpcomingBookings (schedule: every hour)`));
  
  cron.schedule(schedule, async () => {
    const startTime = new Date();
    try {
        const now = new Date();
        const notifyTime = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

        // Find bookings that are 'active' and scheduled exactly 4 hours later
        const upcomingBookings = await Booking.find({
            status: "active",
            date_time: {
                $gte: new Date(notifyTime.getTime() - 59 * 60 * 1000), // 59 min window for safety
                $lte: new Date(notifyTime.getTime() + 59 * 60 * 1000),
            },
        });

        if (upcomingBookings.length === 0) {
            return;
        }

        logger.info(chalk.yellow(`Notify upcoming bookings job: Found ${upcomingBookings.length} upcoming booking(s) to notify`));

        let notifiedCount = 0;
        let errorCount = 0;

        for (const booking of upcomingBookings) {
            try {
                const driver = await Driver.findById(booking.driverId)
                    .select("_id email firstName lastName")
                    .lean();
                if (!driver) {
                    logger.warn(chalk.yellow(`Driver not found for booking ${booking._id}`));
                    continue;
                }

                // Send email notification
                await sendEmail({
                    email: driver.email,
                    subject: "Upcoming Booking Reminder",
                    message: `Hi ${driver.firstName || ""}, your booking from ${booking.from_location} to ${booking.to_location} is coming up at ${booking.date_time}.`,
                });

                // Send real-time notification via Ably to driver-specific channel (for when app is open)
                const driverChannelName = channels.DRIVER(driver._id.toString());
                const upcomingBookingData = {
                    bookingId: booking._id.toString(),
                    driverId: driver._id.toString(),
                    from_location: booking.from_location,
                    to_location: booking.to_location,
                    date_time: booking.date_time instanceof Date 
                        ? booking.date_time.toISOString() 
                        : booking.date_time,
                    price: booking.price,
                    timestamp: new Date().toISOString(),
                };
                
                // Publish to driver-specific channel (primary)
                await publishToChannel(driverChannelName, events.UPCOMING_BOOKING_ADDED, {
                    booking: upcomingBookingData,
                    driverId: driver._id.toString(),
                    action: "reminder",
                    timestamp: new Date().toISOString(),
                });
                
                // Also publish to drivers channel for broadcast compatibility
                await publishToChannel(channels.DRIVERS, events.UPCOMING_BOOKING_ADDED, {
                    booking: upcomingBookingData,
                    driverId: driver._id.toString(),
                    action: "reminder",
                    timestamp: new Date().toISOString(),
                });

                // Send push notification (for when app is closed)
                await sendToDriver(
                    driver._id,
                    {
                        title: "Upcoming Booking Reminder ⏰",
                        body: `Your booking from ${booking.from_location} to ${booking.to_location} is in 4 hours`,
                    },
                    {
                        type: "upcoming-booking",
                        bookingId: booking._id.toString(),
                        from_location: booking.from_location,
                        to_location: booking.to_location,
                        date_time: booking.date_time.toISOString(),
                    }
                );

                notifiedCount++;
                logger.info(chalk.green(`Upcoming booking notification sent for booking ${booking._id} to driver ${driver._id}`));
            } catch (error) {
                errorCount++;
                logger.error(chalk.red(`Error notifying driver for booking ${booking._id}: ${error.message}`));
            }
        }

        const duration = new Date() - startTime;
        logger.info(chalk.cyan(`Notify upcoming bookings job completed: ${notifiedCount} notified, ${errorCount} errors (${duration}ms)`));
    } catch (err) {
        const duration = new Date() - startTime;
        logger.error(chalk.red(`Notify upcoming bookings job error: ${err.message} (${duration}ms)`));
    }
  });
};

module.exports = notifyUpcomingBookingsJob;

