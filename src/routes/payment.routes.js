// routes/payment.routes.js
const express = require("express");
const { handleWebhook, getPaymentStatus,verifyPayment, getAllPayments, deletePayment } = require("../controllers/payment.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");

const router = express.Router();

// Webhook endpoint - must be before other routes to avoid conflicts
router.post("/webhook", handleWebhook);
// GET endpoint for testing webhook route accessibility
router.get("/webhook", (req, res) => {
  res.json({ 
    message: "Webhook endpoint is accessible",
    path: "/api/payments/webhook",
    method: "POST",
    note: "This endpoint accepts POST requests from Stripe",
    status: "ready"
  });
});

router.get("/booking/:bookingId", getPaymentStatus);
router.get("/verify/:sessionId", verifyPayment);
router.get("/all", protect, restrictTo("admin"), getAllPayments);
router.delete("/:paymentId", protect, restrictTo("admin"), deletePayment);

module.exports = router;

