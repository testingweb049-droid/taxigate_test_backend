// controllers/notification.controller.js
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse } = require("../utils/response");
const {
  createNotification: createNotificationService,
  getNotifications: getNotificationsService,
  getUnreadCount: getUnreadCountService,
  markAsRead: markAsReadService,
  markAllAsRead: markAllAsReadService,
  deleteNotification: deleteNotificationService,
} = require("../services/notification.service");

const handleServiceError = (res, err) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  return errorResponse(res, message, statusCode);
};

/**
 * Get all notifications
 */
exports.getNotifications = catchAsync(async (req, res) => {
  try {
    const { page = 1, limit = 20, isRead } = req.query;
    const filters = {};
    
    if (isRead !== undefined) {
      filters.isRead = isRead === "true";
    }
    
    const result = await getNotificationsService(page, limit, filters);
    return successResponse(
      res,
      result,
      "Notifications fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * Get unread notifications count
 */
exports.getUnreadCount = catchAsync(async (req, res) => {
  try {
    const count = await getUnreadCountService();
    return successResponse(
      res,
      { count },
      "Unread count fetched successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * Mark notification as read
 */
exports.markAsRead = catchAsync(async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return errorResponse(res, "Notification ID is required", 400);
    }
    
    const adminId = req.user?.id;
    
    if (!adminId) {
      return errorResponse(res, "Admin ID is required", 400);
    }
    
    const notification = await markAsReadService(notificationId, adminId);
    
    // Convert Mongoose document to plain object and normalize _id to id
    const notificationObj = notification.toObject ? notification.toObject() : notification;
    const normalizedNotification = {
      ...notificationObj,
      id: notificationObj._id?.toString() || notificationObj.id || notificationId,
    };
    
    return successResponse(
      res,
      { notification: normalizedNotification },
      "Notification marked as read"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * Mark all notifications as read
 */
exports.markAllAsRead = catchAsync(async (req, res) => {
  try {
    const adminId = req.user?.id;
    
    if (!adminId) {
      return errorResponse(res, "Admin ID is required", 400);
    }
    
    const result = await markAllAsReadService(adminId);
    
    return successResponse(
      res,
      { 
        updatedCount: result.modifiedCount || 0,
        matchedCount: result.matchedCount || 0
      },
      "All notifications marked as read"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * Delete notification
 */
exports.deleteNotification = catchAsync(async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    if (!notificationId) {
      return errorResponse(res, "Notification ID is required", 400);
    }
    
    await deleteNotificationService(notificationId);
    return successResponse(
      res,
      {},
      "Notification deleted successfully"
    );
  } catch (err) {
    return handleServiceError(res, err);
  }
});

