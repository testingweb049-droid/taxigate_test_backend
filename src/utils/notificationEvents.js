// utils/notificationEvents.js

module.exports = {
    channels: {
        DRIVERS: "drivers", // Broadcast channel for all drivers
        ADMIN: "admin", // Admin dashboard channel
        /**
         * Get driver-specific channel name
         * @param {string} driverId - Driver ID
         * @returns {string} Channel name in format "driver-{id}"
         */
        DRIVER: (driverId) => `driver-${driverId}`,
    },

    events: {
        NEW_BOOKING: "new-booking",
        BOOKING_TAKEN: "booking-taken",
        BOOKING_ASSIGNED: "booking-assigned",
        BOOKING_CANCELLED: "booking-cancelled",
        BOOKING_REMOVED: "booking-removed",
        BOOKING_EXPIRED: "booking-expired",
        BOOKING_EXPIRED_ADMIN: "booking-expired-admin",
        BOOKING_CREATED_ADMIN: "booking-created-admin",
        LIVE_BOOKING_ADDED: "live-booking-added",
        LIVE_BOOKING_REMOVED: "live-booking-removed",
        LIVE_BOOKING_UPDATED: "live-booking-updated",
        BOOKING_STARTED: "booking-started",
        BOOKING_PICKED_UP: "booking-picked-up",
        BOOKING_DROPPED_OFF: "booking-dropped-off",
        BOOKING_COMPLETED: "booking-completed",
        BOOKING_REJECTED: "booking-rejected",
        BOOKING_UNASSIGNED: "booking-unassigned",
        BOOKING_ACCEPTED_ADMIN: "booking-accepted-admin",
        BOOKING_REJECTED_ADMIN: "booking-rejected-admin",
        DRIVER_REGISTERED: "driver-registered",
        VEHICLE_UPLOADED: "vehicle-uploaded",
        UPCOMING_BOOKING_ADDED: "upcoming-booking-added",
        UPCOMING_BOOKING_REMOVED: "upcoming-booking-removed",
        ACTIVE_BOOKING_UPDATED: "active-booking-updated",
        ASSIGNED_BOOKING_ADDED: "assigned-booking-added",
        ASSIGNED_BOOKING_REMOVED: "assigned-booking-removed",
        DRIVER_ONLINE_STATUS_CHANGED: "driver-online-status-changed",
        DRIVER_STATUS_UPDATED: "driver-status-updated",
        WALLET_BALANCE_UPDATED: "wallet-balance-updated",
        DRIVER_PROFILE_UPDATED: "driver-profile-updated",
        DRIVER_ACCOUNT_DELETED: "driver-account-deleted",
        BOOKING_REMINDER: "booking-reminder",
    }
};
