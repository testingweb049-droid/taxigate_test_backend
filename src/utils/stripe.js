// utils/stripe.js
const Stripe = require("stripe");

/**
 * Initialize Stripe instance
 */
let stripeInstance = null;

const getStripe = () => {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2024-12-18.acacia", // Use latest stable version
    });
  }
  return stripeInstance;
};

/**
 * Verify Stripe webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - Stripe signature header
 * @param {string} secret - Webhook signing secret
 * @returns {object} - Decoded event object
 */
const verifyWebhookSignature = (payload, signature, secret) => {
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  try {
    const stripe = getStripe();
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
};

/**
 * Create Stripe checkout session
 * @param {object} params - Session parameters
 * @param {number} params.amount - Amount in cents
 * @param {string} params.currency - Currency code (default: eur)
 * @param {string} params.customerEmail - Customer email
 * @param {string} params.successUrl - Success redirect URL
 * @param {string} params.cancelUrl - Cancel redirect URL
 * @param {string} params.clientReferenceId - Client reference ID (booking ID)
 * @param {object} params.metadata - Additional metadata
 * @returns {Promise<object>} - Stripe session object
 */
const createCheckoutSession = async ({
  amount,
  currency = "eur",
  customerEmail,
  successUrl,
  cancelUrl,
  clientReferenceId,
  metadata = {},
}) => {
  const stripe = getStripe();

  // Validate URLs
  if (!successUrl || (!successUrl.startsWith("http://") && !successUrl.startsWith("https://"))) {
    throw new Error("Invalid successUrl: must start with http:// or https://");
  }
  if (!cancelUrl || (!cancelUrl.startsWith("http://") && !cancelUrl.startsWith("https://"))) {
    throw new Error("Invalid cancelUrl: must start with http:// or https://");
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card", "ideal"],
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: "Taxi Booking Payment",
          },
          unit_amount: Math.round(amount * 100), // Convert to cents
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId,
    metadata: {
      ...metadata,
      bookingId: clientReferenceId,
    },
  });

  return session;
};

module.exports = {
  getStripe,
  verifyWebhookSignature,
  createCheckoutSession,
};

