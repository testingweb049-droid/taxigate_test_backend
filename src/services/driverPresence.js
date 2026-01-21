const mongoose = require("mongoose");
const Driver = require("../models/driver.model");
const { notifyDriverOnlineStatusChanged } = require("./driverNotifications");

let onlineDrivers = new Set();

/**
 * Initialize online drivers from DB on server start
 */
const initializeOnlineDrivers = async () => {
    try {
        // Check if database is connected
        if (mongoose.connection.readyState !== 1) {
            return;
        }
        const drivers = await Driver.find({ isOnline: true }).select("_id");
        onlineDrivers = new Set(drivers.map(d => d._id.toString()));
    } catch (error) {
        // Don't throw - allow app to continue
    }
};

/**
 * Mark driver as online
 * @param {String} driverId
 */
const goOnline = async (driverId) => {
    onlineDrivers.add(driverId);

    // Persist in DB
    await Driver.findByIdAndUpdate(driverId, { isOnline: true }, { validateBeforeSave: false });

    // Send real-time notification to admin dashboard (fire-and-forget)
    setImmediate(async () => {
        try {
            await notifyDriverOnlineStatusChanged(driverId, true);
        } catch (error) {
            // Log error but don't block - notifications are non-critical
        }
    });
};

/**
 * Mark driver as offline
 * @param {String} driverId
 */
const goOffline = async (driverId) => {
    onlineDrivers.delete(driverId);

    // Persist in DB
    await Driver.findByIdAndUpdate(driverId, { isOnline: false }, { validateBeforeSave: false });

    // Send real-time notification to admin dashboard (fire-and-forget)
    setImmediate(async () => {
        try {
            await notifyDriverOnlineStatusChanged(driverId, false);
        } catch (error) {
            // Log error but don't block - notifications are non-critical
        }
    });
};

/**
 * Get all online drivers
 * @returns {Array<String>} driver IDs
 */
const getOnlineDrivers = () => Array.from(onlineDrivers);

module.exports = {
    initializeOnlineDrivers,
    goOnline,
    goOffline,
    getOnlineDrivers,
};
