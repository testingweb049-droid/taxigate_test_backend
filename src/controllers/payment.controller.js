// controllers/payment.controller.js
const Payment = require("../models/payment.model");
const Booking = require("../models/booking.model");
const catchAsync = require("../utils/catchAsync");
const { successResponse, errorResponse } = require("../utils/response");
const { verifyWebhookSignature, getStripe } = require("../utils/stripe");
const { confirmPaymentAndNotify } = require("../services/paymentConfirmation.service");
const { verifyAndConfirmPaymentBySessionId } = require("../services/payment.service");

exports.handleWebhook = catchAsync(async (req, res) => {
  console.log("[WEBHOOK] Webhook endpoint hit", {
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    hasRawBody: !!req.rawBody,
    hasBody: !!req.body,
    contentType: req.headers["content-type"],
    hasSignature: !!req.headers["stripe-signature"]
  });

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured");
    return errorResponse(res, "Webhook secret not configured", 500);
  }

  // Get raw body - MUST use rawBody for signature verification
  // Stripe requires the exact raw body bytes as received - byte-for-byte match
  let payload = req.rawBody;
  
  // Log what we have before processing
  console.log("[WEBHOOK] Body state:", {
    hasRawBody: !!req.rawBody,
    rawBodyType: req.rawBody ? typeof req.rawBody : 'none',
    rawBodyIsBuffer: req.rawBody ? Buffer.isBuffer(req.rawBody) : false,
    hasBody: !!req.body,
    bodyType: req.body ? typeof req.body : 'none',
    bodyIsBuffer: req.body ? Buffer.isBuffer(req.body) : false,
    bodyIsObject: req.body ? (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) : false
  });
  
  // CRITICAL: If rawBody is not a Buffer, we cannot verify the signature
  // Stripe signature verification requires the exact raw bytes
  if (!payload) {
    // Try to use body if it's a Buffer
    if (req.body && Buffer.isBuffer(req.body)) {
      console.warn("[WEBHOOK] rawBody not found, using req.body (Buffer)");
      payload = req.body;
    } else {
      console.error("[WEBHOOK] ERROR: rawBody not found and req.body is not a Buffer");
      console.error("[WEBHOOK] Cannot verify signature without raw body bytes");
      return errorResponse(res, "Raw body not available for signature verification", 400);
    }
  }
  
  // Ensure payload is a Buffer - this is required for signature verification
  if (!Buffer.isBuffer(payload)) {
    if (typeof payload === 'string') {
      console.warn("[WEBHOOK] Payload is string, converting to Buffer");
      // Convert string to Buffer - but this may cause signature issues if encoding differs
      payload = Buffer.from(payload, 'utf8');
    } else {
      console.error("[WEBHOOK] ERROR: Payload is not a Buffer or string:", typeof payload);
      return errorResponse(res, "Invalid payload format - must be Buffer for signature verification", 400);
    }
  }
  
  // Log final payload info
  console.log("[WEBHOOK] Using payload:", {
    isBuffer: Buffer.isBuffer(payload),
    length: payload.length,
    firstBytes: payload.slice(0, 50).toString('hex')
  });

  if (!sig) {
    console.error("[WEBHOOK] Missing stripe-signature header");
    return errorResponse(res, "Missing stripe-signature header", 400);
  }

  // Log signature info (without exposing the full secret)
  console.log("[WEBHOOK] Signature info:", {
    signatureLength: sig.length,
    signaturePrefix: sig.substring(0, 20),
    secretConfigured: !!webhookSecret,
    secretPrefix: webhookSecret ? webhookSecret.substring(0, 10) : 'none'
  });

  let event;

  try {
    // Stripe's constructEvent can accept Buffer or string
    // Try with Buffer first (preferred), but if that fails, try as string
    // The payload must be the exact raw bytes as received
    console.log("[WEBHOOK] Attempting signature verification with Buffer...");
    event = verifyWebhookSignature(payload, sig, webhookSecret);
    console.log("[WEBHOOK] Event verified successfully:", event.type, event.id);
  } catch (err) {
    console.error("[WEBHOOK] Signature verification failed with Buffer");
    console.error("[WEBHOOK] Error details:", {
      message: err.message,
      payloadLength: payload.length,
      payloadType: Buffer.isBuffer(payload) ? 'Buffer' : typeof payload
    });
    
    // If Buffer fails, try as string (sometimes Stripe expects string)
    // But this should rarely be needed
    try {
      console.log("[WEBHOOK] Retrying with payload as string...");
      const payloadString = payload.toString('utf8');
      event = verifyWebhookSignature(payloadString, sig, webhookSecret);
      console.log("[WEBHOOK] Event verified successfully with string:", event.type, event.id);
    } catch (stringErr) {
      console.error("[WEBHOOK] Signature verification also failed with string");
      console.error("[WEBHOOK] String error:", stringErr.message);
      
      // Provide helpful error message
      const errorMsg = `Webhook signature verification failed: ${err.message}. ` +
        `Please verify that STRIPE_WEBHOOK_SECRET in Vercel matches the webhook secret ` +
        `for the endpoint: https://taxigate-test-backend.vercel.app/api/payments/webhook`;
      
      return errorResponse(res, errorMsg, 400);
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

