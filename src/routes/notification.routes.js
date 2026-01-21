const express = require("express");
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require("../controllers/notification.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(protect);
router.use(restrictTo("admin"));

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/all/read", markAllAsRead);
router.patch("/:notificationId/read", markAsRead);
router.delete("/:notificationId", deleteNotification);

module.exports = router;

