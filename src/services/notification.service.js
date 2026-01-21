// services/notification.service.js
const mongoose = require("mongoose");
const Notification = require("../models/notification.model");

/**
 * Create a notification
 */
exports.createNotification = async (notificationData) => {
  const notification = await Notification.create(notificationData);
  return notification;
};

/**
 * Get all notifications for admin (with pagination)
 */
exports.getNotifications = async (page = 1, limit = 20, filters = {}) => {
  const skip = (parseInt(page) - 1) * parseInt(limit);
  
  const query = { ...filters };
  
  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Notification.countDocuments(query),
  ]);
  
  // Normalize _id to id for frontend compatibility
  const normalizedNotifications = notifications.map((notification) => ({
    ...notification,
    id: notification._id?.toString() || notification.id,
  }));
  
  return {
    notifications: normalizedNotifications,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    },
  };
};

/**
 * Get unread notifications count
 */
exports.getUnreadCount = async () => {
  return Notification.countDocuments({ isRead: false });
};

/**
 * Mark notification as read
 */
exports.markAsRead = async (notificationId, adminId) => {
  if (!notificationId) {
    throw new Error("Notification ID is required");
  }

  if (!adminId) {
    throw new Error("Admin ID is required");
  }

  // Validate notificationId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new Error("Invalid notification ID format");
  }

  // Validate adminId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    throw new Error("Invalid admin ID format");
  }

  const notification = await Notification.findById(notificationId);
  if (!notification) {
    throw new Error("Notification not found");
  }
  
  notification.isRead = true;
  notification.readBy = adminId;
  notification.readAt = new Date();
  await notification.save();
  
  return notification;
};

/**
 * Mark all notifications as read
 */
exports.markAllAsRead = async (adminId) => {
  if (!adminId) {
    throw new Error("Admin ID is required");
  }

  // Validate adminId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(adminId)) {
    throw new Error("Invalid admin ID format");
  }

  const result = await Notification.updateMany(
    { isRead: false },
    {
      $set: {
        isRead: true,
        readBy: adminId,
        readAt: new Date(),
      },
    }
  );
  
  return result;
};

/**
 * Delete notification
 */
exports.deleteNotification = async (notificationId) => {
  if (!notificationId) {
    throw new Error("Notification ID is required");
  }

  // Validate notificationId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new Error("Invalid notification ID format");
  }

  const notification = await Notification.findByIdAndDelete(notificationId);
  
  if (!notification) {
    throw new Error("Notification not found");
  }
  
  return notification;
};

