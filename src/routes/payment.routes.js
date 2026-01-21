// routes/payment.routes.js
const express = require("express");
const { handleWebhook, getPaymentStatus,verifyPayment, getAllPayments, deletePayment } = require("../controllers/payment.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/webhook", handleWebhook);
router.get("/booking/:bookingId", getPaymentStatus);
router.get("/verify/:sessionId", verifyPayment);
router.get("/all", protect, restrictTo("admin"), getAllPayments);
router.delete("/:paymentId", protect, restrictTo("admin"), deletePayment);

router.get("/webhook/test", (req, res) => {
  console.log("[WEBHOOK TEST] Webhook route is accessible");
  res.json({ 
    message: "Webhook endpoint is accessible",
    path: "/api/payments/webhook",
    method: "POST",
    note: "Use Stripe CLI or ngrok to forward webhooks to this endpoint"
  });
});

module.exports = router;

