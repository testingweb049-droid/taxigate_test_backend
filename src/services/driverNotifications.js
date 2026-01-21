// src/services/driverNotifications.js
const Admin = require("../models/admin.model");
const Driver = require("../models/driver.model");
const Vehicle = require("../models/vehicle.model");
const { publishToChannel } = require("../../config/ably");
const { channels, events } = require("../utils/notificationEvents");
const { createNotification } = require("./notification.service");
const logger = require("../utils/logger");

/**
 * Notify admin when a new driver registers
 * @param {Object} driver - Driver object
 */
const notifyDriverRegistered = async (driver) => {
  try {
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }

    const adminIds = admins.map((a) => a._id.toString());
    const driverData = {
      driverId: driver._id.toString(),
      email: driver.email,
      phone: driver.phone,
      status: driver.status,
      timestamp: new Date().toISOString(),
    };

    // Create notification in database for each admin
    const notificationPromises = admins.map(async (admin) => {
      try {
        const notification = await createNotification({
          type: "driver-registered",
          title: `New Driver Registered`,
          message: `A new driver has registered: ${driver.email}`,
          driverId: driver._id,
          driverDetails: {
            email: driver.email,
            phone: driver.phone,
            status: driver.status,
          },
          priority: "medium",
          data: {
            driverId: driverData.driverId,
            email: driver.email,
            phone: driver.phone,
          },
        });
        return notification;
      } catch (notifError) {
        return null;
      }
    });

    await Promise.allSettled(notificationPromises);

    // Send Ably real-time event to admin channel
    publishToChannel(channels.ADMIN, events.DRIVER_REGISTERED, {
      ...driverData,
      adminIds,
      message: `New driver registered: ${driver.email}`,
    }).then(() => {
    }).catch((ablyError) => {
    });

  } catch (error) {
  }
};

/**
 * Notify admin when a driver uploads vehicle information completely
 * @param {Object} vehicle - Vehicle object (populated with driver)
 * @param {Object} driver - Driver object (optional, will be populated if not provided)
 */
const notifyVehicleUploaded = async (vehicle, driver = null) => {
  try {
    
    // Populate driver if not provided
    if (!driver && vehicle.driver) {
      if (typeof vehicle.driver === 'object' && vehicle.driver._id) {
        driver = vehicle.driver;
      } else {
        driver = await Driver.findById(vehicle.driver).select("email phone firstName lastName").lean();
      }
    }

    if (!driver) {
      return;
    }

    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }

    const adminIds = admins.map((a) => a._id.toString());
    const vehicleData = {
      vehicleId: vehicle._id.toString(),
      driverId: driver._id?.toString() || driver.id?.toString() || vehicle.driver?.toString(),
      driverEmail: driver.email,
      driverName: driver.firstName && driver.lastName 
        ? `${driver.firstName} ${driver.lastName}` 
        : driver.email,
      vehicleType: vehicle.type,
      vehicleBrand: vehicle.brand,
      vehicleModel: vehicle.model,
      plateNumber: vehicle.plateNumber,
      status: vehicle.status,
      timestamp: new Date().toISOString(),
    };

    // Create notification in database for each admin
    const notificationPromises = admins.map(async (admin) => {
      try {
        const notification = await createNotification({
          type: "vehicle-uploaded",
          title: `Vehicle Information Uploaded`,
          message: `Driver ${vehicleData.driverName} (${vehicleData.driverEmail}) has uploaded vehicle information: ${vehicleData.vehicleBrand} ${vehicleData.vehicleModel} (${vehicleData.plateNumber})`,
          driverId: vehicleData.driverId,
          vehicleId: vehicleData.vehicleId,
          vehicleDetails: {
            type: vehicleData.vehicleType,
            brand: vehicleData.vehicleBrand,
            model: vehicleData.vehicleModel,
            plateNumber: vehicleData.plateNumber,
            status: vehicleData.status,
          },
          priority: "medium",
          data: {
            vehicleId: vehicleData.vehicleId,
            driverId: vehicleData.driverId,
            driverEmail: vehicleData.driverEmail,
            plateNumber: vehicleData.plateNumber,
          },
        });
        return notification;
      } catch (notifError) {
        return null;
      }
    });

    await Promise.allSettled(notificationPromises);

    // Send Ably real-time event to admin channel
    publishToChannel(channels.ADMIN, events.VEHICLE_UPLOADED, {
      ...vehicleData,
      adminIds,
      message: `Driver ${vehicleData.driverName} has uploaded vehicle information: ${vehicleData.vehicleBrand} ${vehicleData.vehicleModel} (${vehicleData.plateNumber})`,
    }).then(() => {
    }).catch((ablyError) => {
    });

  } catch (error) {
  }
};

/**
 * Notify driver and admin when driver status changes (Approved/Rejected)
 * @param {Object} driver - Driver object
 * @param {String} oldStatus - Previous status
 * @param {String} newStatus - New status
 */
const notifyDriverStatusChanged = async (driver, oldStatus, newStatus) => {
  try {
    const driverId = driver._id?.toString() || driver.id?.toString();
    if (!driverId) {
      return;
    }

    const driverData = {
      driverId: driverId,
      email: driver.email,
      phone: driver.phone,
      firstName: driver.firstName,
      lastName: driver.lastName,
      oldStatus: oldStatus,
      newStatus: newStatus,
      timestamp: new Date().toISOString(),
    };

    // Notify driver via driver-specific channel
    const driverChannelName = channels.DRIVER(driverId);
    const driverNotificationData = {
      ...driverData,
      status: newStatus,
      message: newStatus === "Approved" 
        ? "Your driver account has been approved! You can now start accepting bookings."
        : "Your driver account has been rejected. Please contact support for more information.",
    };

    publishToChannel(driverChannelName, events.DRIVER_STATUS_UPDATED, driverNotificationData)
      .then(() => {
      })
      .catch((ablyError) => {
      });

    // Also publish to drivers broadcast channel for compatibility
    publishToChannel(channels.DRIVERS, events.DRIVER_STATUS_UPDATED, {
      ...driverNotificationData,
      onlineDriverIds: [driverId],
    }).then(() => {
    }).catch((ablyError) => {
    });

    // Notify admin dashboard
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    if (admins.length > 0) {
      const adminIds = admins.map((a) => a._id.toString());
      const adminNotificationData = {
        ...driverData,
        status: newStatus,
        driverName: driver.firstName && driver.lastName 
          ? `${driver.firstName} ${driver.lastName}` 
          : driver.email,
        adminIds,
        message: `Driver ${driver.email} status changed from ${oldStatus} to ${newStatus}`,
      };

      publishToChannel(channels.ADMIN, events.DRIVER_STATUS_UPDATED, adminNotificationData)
        .then(() => {
        })
        .catch((ablyError) => {
        });
    }
  } catch (error) {
  }
};

/**
 * Notify admin when driver online status changes
 * @param {String} driverId - Driver ID
 * @param {Boolean} isOnline - Online status
 * @param {Object} driver - Driver object (optional, will be fetched if not provided)
 */
const notifyDriverOnlineStatusChanged = async (driverId, isOnline, driver = null) => {
  try {
    // Fetch driver if not provided
    if (!driver) {
      driver = await Driver.findById(driverId)
        .select("_id email firstName lastName isOnline")
        .lean();
    }

    if (!driver) {
      return;
    }

    const driverData = {
      driverId: driver._id?.toString() || driverId.toString(),
      email: driver.email,
      firstName: driver.firstName,
      lastName: driver.lastName,
      isOnline: isOnline,
      timestamp: new Date().toISOString(),
    };

    // Notify admin dashboard
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    if (admins.length > 0) {
      const adminIds = admins.map((a) => a._id.toString());
      const adminNotificationData = {
        ...driverData,
        driverName: driver.firstName && driver.lastName 
          ? `${driver.firstName} ${driver.lastName}` 
          : driver.email,
        adminIds,
        message: `Driver ${driver.email} is now ${isOnline ? "online" : "offline"}`,
      };

      publishToChannel(channels.ADMIN, events.DRIVER_ONLINE_STATUS_CHANGED, adminNotificationData)
        .then(() => {
        })
        .catch((ablyError) => {
        });
    }
  } catch (error) {
  }
};

/**
 * Notify driver when wallet balance is updated
 * PHASE 3: Added retry mechanism and comprehensive error handling
 * @param {String} driverId - Driver ID
 * @param {Number} amount - Transaction amount
 * @param {Number} balanceAfter - New balance after transaction
 * @param {Object} transaction - Transaction object (optional)
 * @param {Object} booking - Booking object (optional)
 * @param {Number} retryCount - Internal retry counter (default: 0)
 * @param {Number} maxRetries - Maximum retry attempts (default: 3)
 */
const notifyWalletBalanceUpdated = async (driverId, amount, balanceAfter, transaction = null, booking = null, retryCount = 0, maxRetries = 3) => {
  try {
    const driverChannelName = channels.DRIVER(driverId.toString());
    
    const walletUpdateData = {
      driverId: driverId.toString(),
      amount: amount,
      balanceAfter: balanceAfter,
      timestamp: new Date().toISOString(),
    };

    // Add transaction details if available
    if (transaction) {
      walletUpdateData.transactionId = transaction._id?.toString() || transaction.id;
      walletUpdateData.transactionType = transaction.type || "credit";
      walletUpdateData.description = transaction.description;
    }

    // Add booking details if available
    if (booking) {
      walletUpdateData.bookingId = booking._id?.toString() || booking.id;
      walletUpdateData.bookingFrom = booking.from_location;
      walletUpdateData.bookingTo = booking.to_location;
    }

    const notificationData = {
      ...walletUpdateData,
      message: amount > 0 
        ? `Your wallet has been credited with €${amount.toFixed(2)}. New balance: €${balanceAfter.toFixed(2)}`
        : `Your wallet has been debited with €${Math.abs(amount).toFixed(2)}. New balance: €${balanceAfter.toFixed(2)}`,
    };

    // PHASE 3: Retry mechanism with exponential backoff
    const publishWithRetry = async (channelName, eventName, data, isRetry = false) => {
      try {
        await publishToChannel(channelName, eventName, data);
        if (isRetry) {
          logger.info(`[WALLET] Successfully sent wallet update to ${channelName} after retry ${retryCount}`);
        } else {
          logger.info(`[WALLET] Successfully sent wallet update to ${channelName} for driver ${driverId}`);
        }
        return true;
      } catch (ablyError) {
        if (retryCount < maxRetries) {
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 5000); // Max 5 seconds
          logger.warn(`[WALLET] Failed to send wallet update to ${channelName}, retrying in ${backoffTime}ms (attempt ${retryCount + 1}/${maxRetries})`);
          
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          return await publishWithRetry(channelName, eventName, data, true);
        } else {
          logger.error(`[WALLET] Failed to send wallet update to ${channelName} after ${maxRetries} attempts: ${ablyError?.message || ablyError}`);
          throw ablyError;
        }
      }
    };

    // Notify driver via driver-specific channel (with retry)
    try {
      await publishWithRetry(driverChannelName, events.WALLET_BALANCE_UPDATED, notificationData);
    } catch (error) {
      logger.error(`[WALLET] Critical: Failed to send wallet update to driver ${driverId} after all retries`);
      // Don't throw - log error but continue to try broadcast channel
    }

    // Also publish to drivers broadcast channel for compatibility (with retry)
    try {
      await publishWithRetry(channels.DRIVERS, events.WALLET_BALANCE_UPDATED, {
        ...notificationData,
        onlineDriverIds: [driverId.toString()],
      });
    } catch (error) {
      logger.error(`[WALLET] Critical: Failed to send wallet update to broadcast channel for driver ${driverId} after all retries`);
      // Don't throw - error already logged
    }
  } catch (error) {
    logger.error(`[WALLET] Unexpected error in notifyWalletBalanceUpdated for driver ${driverId}: ${error?.message || error}`);
    // Re-throw to allow caller to handle if needed
    throw error;
  }
};

/**
 * Notify admin when driver profile is updated
 * @param {Object} driver - Driver object (updated)
 * @param {Object} updatedFields - Object containing updated fields
 */
const notifyDriverProfileUpdated = async (driver, updatedFields = {}) => {
  try {
    const driverId = driver._id?.toString() || driver.id?.toString();
    if (!driverId) {
      return;
    }

    const driverData = {
      driverId: driverId,
      email: driver.email,
      phone: driver.phone,
      firstName: driver.firstName,
      lastName: driver.lastName,
      profilePicture: driver.profilePicture,
      updatedFields: Object.keys(updatedFields),
      timestamp: new Date().toISOString(),
    };

    // Notify admin dashboard
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    if (admins.length > 0) {
      const adminIds = admins.map((a) => a._id.toString());
      const adminNotificationData = {
        ...driverData,
        driverName: driver.firstName && driver.lastName 
          ? `${driver.firstName} ${driver.lastName}` 
          : driver.email,
        adminIds,
        message: `Driver ${driver.email} has updated their profile`,
      };

      publishToChannel(channels.ADMIN, events.DRIVER_PROFILE_UPDATED, adminNotificationData)
        .then(() => {
        })
        .catch((ablyError) => {
        });
    }
  } catch (error) {
  }
};

/**
 * Notify admin when a driver deletes their account
 * @param {Object} driver - Driver object
 * @param {Number} vehiclesDeletedCount - Number of vehicles deleted
 */
const notifyDriverAccountDeleted = async (driver, vehiclesDeletedCount = 0) => {
  try {
    const admins = await Admin.find({ active: true }).select("_id email name").lean();
    
    if (admins.length === 0) {
      return;
    }

    const adminIds = admins.map((a) => a._id.toString());
    const driverData = {
      driverId: driver._id.toString(),
      email: driver.email,
      phone: driver.phone,
      firstName: driver.firstName,
      lastName: driver.lastName,
      vehiclesDeletedCount,
      timestamp: new Date().toISOString(),
    };

    // Create notification in database for each admin
    const notificationPromises = admins.map(async (admin) => {
      try {
        const notification = await createNotification({
          type: "driver-account-deleted",
          title: `Driver Account Deleted`,
          message: `Driver ${driver.email} has deleted their account. ${vehiclesDeletedCount} vehicle(s) were also deleted.`,
          driverId: driver._id,
          driverDetails: {
            email: driver.email,
            phone: driver.phone,
            firstName: driver.firstName,
            lastName: driver.lastName,
          },
          priority: "high",
          data: {
            driverId: driverData.driverId,
            email: driver.email,
            vehiclesDeletedCount,
          },
        });
        return notification;
      } catch (notifError) {
        return null;
      }
    });

    await Promise.allSettled(notificationPromises);

    // Send Ably real-time event to admin channel
    publishToChannel(channels.ADMIN, events.DRIVER_ACCOUNT_DELETED, {
      ...driverData,
      adminIds,
      message: `Driver ${driver.email} has deleted their account. ${vehiclesDeletedCount} vehicle(s) were also deleted.`,
    }).then(() => {
    }).catch((ablyError) => {
    });

  } catch (error) {
    // Log error but don't throw
  }
};

module.exports = {
  notifyDriverRegistered,
  notifyVehicleUploaded,
  notifyDriverStatusChanged,
  notifyDriverOnlineStatusChanged,
  notifyWalletBalanceUpdated,
  notifyDriverProfileUpdated,
  notifyDriverAccountDeleted,
};

