// controllers/payment.controller.js
const Payment = require("../models/payment.model");
const Booking = require("../models/booking.model");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse } = require("../utils/response");
const { verifyWebhookSignature, getStripe } = require("../utils/stripe");
const { confirmPaymentAndNotify } = require("../services/paymentConfirmation.service");
const { verifyAndConfirmPaymentBySessionId } = require("../services/payment.service");

exports.handleWebhook = catchAsync(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured");
    return errorResponse(res, "Webhook secret not configured", 500);
  }
  let payload = req.rawBody;
  if (!payload) {
    if (req.body && Buffer.isBuffer(req.body)) {
      payload = req.body;
    } else {
      return errorResponse(res, "Raw body not available for signature verification", 400);
    }
  }
  
  // Ensure payload is a Buffer - this is required for signature verification
  if (!Buffer.isBuffer(payload)) {
    if (typeof payload === 'string') {
      payload = Buffer.from(payload, 'utf8');
    } else {
      return errorResponse(res, "Invalid payload format - must be Buffer for signature verification", 400);
    }
  }

  if (!sig) {
    return errorResponse(res, "Missing stripe-signature header", 400);
  }

  // Validate webhook secret format
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) {
    return errorResponse(res, "Invalid webhook secret format. Must start with 'whsec_'. Check Stripe Dashboard for the correct signing secret.", 500);
  }

  let event;

  try {
    event = verifyWebhookSignature(payload, sig, webhookSecret);
  } catch (err) {
    // If Buffer fails, try as string (fallback)
    try {
      const payloadString = payload.toString('utf8');
      event = verifyWebhookSignature(payloadString, sig, webhookSecret);
    } catch (stringErr) {
      return errorResponse(res, `Webhook signature verification failed: ${err.message}`, 400);
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      default:
        console.log("[WEBHOOK] Unhandled event type:", event.type);
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Error processing webhook:", error.message);
    console.error("[WEBHOOK] Error stack:", error.stack);
    // Still return 200 to prevent Stripe from retrying
    return res.status(200).json({ received: true, error: error.message });
  }
});

const handleCheckoutSessionCompleted = async (session) => {
  const payment = await Payment.findOne({ stripeSessionId: session.id });
  if (!payment) {
    console.error(`[WEBHOOK] Payment not found for session: ${session.id}`);
    throw new Error(`Payment not found for session: ${session.id}`);
  }
  
  if (payment.status === "succeeded") {
    return;
  }

  const bookingId = payment.bookingId;

  try {
    await confirmPaymentAndNotify(bookingId, payment._id);
    console.log(`[WEBHOOK] Payment confirmed for booking: ${bookingId}`);
  } catch (error) {
    console.error(`[WEBHOOK] Error confirming payment:`, error.message);
    throw error;
  }
};

const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const payment = await Payment.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (!payment) {
    return;
  }

  if (payment.status !== "succeeded") {
    payment.status = "succeeded";
    payment.paidAt = new Date();
    await payment.save();

    const booking = await Booking.findByIdAndUpdate(
      payment.bookingId,
      { $set: { isPaid: true, paymentId: payment._id } },
      { new: true }
    );

    if (booking && !booking.isPaid) {
      await confirmPaymentAndNotify(payment.bookingId, payment._id);
    }
  } else {
    const booking = await Booking.findById(payment.bookingId);
    if (booking && !booking.isPaid) {
      await confirmPaymentAndNotify(payment.bookingId, payment._id);
    }
  }
};

const handlePaymentIntentFailed = async (paymentIntent) => {
  const payment = await Payment.findOne({
    stripePaymentIntentId: paymentIntent.id,
  });

  if (payment && payment.status === "pending") {
    payment.status = "failed";
    payment.failedAt = new Date();
    await payment.save();
  }
};

exports.getPaymentStatus = catchAsync(async (req, res) => {
  const { bookingId } = req.params;

  const payment = await Payment.findOne({ bookingId }).populate("bookingId");

  if (!payment) {
    return errorResponse(res, "Payment not found for this booking", 404);
  }

  return successResponse(
    res,
    {
      payment: {
        id: payment._id,
        bookingId: payment.bookingId._id || payment.bookingId,
        status: payment.status,
        amount: payment.amount / 100,
        currency: payment.currency,
        stripeSessionId: payment.stripeSessionId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      },
    },
    "Payment status retrieved successfully"
  );
});

exports.verifyPayment = catchAsync(async (req, res) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return errorResponse(res, "Session ID is required", 400);
  }

  try {
    const result = await verifyAndConfirmPaymentBySessionId(sessionId);

    return successResponse(
      res,
      {
        payment: {
          id: result.payment._id,
          bookingId: result.payment.bookingId._id || result.payment.bookingId,
          status: result.payment.status,
          amount: result.payment.amount / 100,
          currency: result.payment.currency,
          stripeSessionId: result.payment.stripeSessionId,
          paidAt: result.payment.paidAt,
          createdAt: result.payment.createdAt,
        },
        booking: result.booking
          ? {
              id: result.booking._id,
              isPaid: result.booking.isPaid,
              orderNumber: result.booking.orderNumber,
            }
          : null,
        verified: result.verified,
        confirmed: result.confirmed || false,
        alreadyConfirmed: result.alreadyConfirmed || false,
      },
      result.verified
        ? "Payment verified and confirmed"
        : "Payment verification completed"
    );
  } catch (error) {
    console.error(`[VERIFY] Error in verifyPayment endpoint:`, error);
    return errorResponse(
      res,
      error.message || "Failed to verify payment",
      500
    );
  }
});

exports.getAllPayments = catchAsync(async (req, res) => {
  const { page = 1, limit = 12, status } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build query
  const query = {};
  if (status) {
    query.status = status;
  }

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate("bookingId", "orderNumber user_name email from_location to_location price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Payment.countDocuments(query),
  ]);

  const formattedPayments = payments.map((payment) => ({
    id: payment._id,
    bookingId: payment.bookingId?._id || payment.bookingId,
    booking: payment.bookingId
      ? {
          id: payment.bookingId._id,
          orderNumber: payment.bookingId.orderNumber,
          user_name: payment.bookingId.user_name,
          email: payment.bookingId.email,
          from_location: payment.bookingId.from_location,
          to_location: payment.bookingId.to_location,
          price: payment.bookingId.price,
        }
      : null,
    stripeSessionId: payment.stripeSessionId,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    amount: payment.amount / 100, // Convert from cents to currency unit
    currency: payment.currency,
    status: payment.status,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
    refundedAt: payment.refundedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  }));

  return successResponse(
    res,
    {
      payments: formattedPayments,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
      },
    },
    "Payments fetched successfully"
  );
});

exports.deletePayment = catchAsync(async (req, res) => {
  const { paymentId } = req.params;

  const payment = await Payment.findById(paymentId);

  if (!payment) {
    return errorResponse(res, "Payment not found", 404);
  }

  await Payment.findByIdAndDelete(paymentId);

  return successResponse(
    res,
    {
      payment: {
        id: payment._id,
        bookingId: payment.bookingId,
        status: payment.status,
      },
    },
    "Payment deleted successfully"
  );
});

