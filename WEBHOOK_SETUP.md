# Stripe Webhook Production Setup Guide

## Production Webhook URL
```
https://taxigate-test-backend.vercel.app/api/payments/webhook
```

## Step 1: Configure Webhook in Stripe Dashboard

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"** or **"Add webhook endpoint"**
3. **IMPORTANT**: Enter your webhook URL exactly as shown (no trailing slash):
   ```
   https://taxigate-test-backend.vercel.app/api/payments/webhook
   ```
   ⚠️ **The URL must match exactly** - any difference will cause signature verification to fail
4. Select the events to listen for:
   - ✅ `checkout.session.completed`
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
   - ✅ `charge.updated` (optional, if you want to handle charge updates)
5. Click **"Add endpoint"**

## Step 2: Get Production Webhook Secret

1. After creating the webhook endpoint, click on it in the Stripe Dashboard
2. In the **"Signing secret"** section, click **"Reveal"** or **"Click to reveal"**
3. Copy the webhook secret (it starts with `whsec_...`)
4. **Important**: This is different from the CLI secret you used for local testing

## Step 3: Add Webhook Secret to Vercel Environment Variables

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project: `taxigate-test-backend` (or your project name)
3. Go to **Settings** → **Environment Variables**
4. Add a new environment variable:
   - **Name**: `STRIPE_WEBHOOK_SECRET`
   - **Value**: `whsec_...` (paste the production webhook secret from Step 2)
   - **Environment**: Select **Production** (and optionally Preview/Development if needed)
5. Click **Save**
6. **Redeploy** your application for the changes to take effect

## Step 4: Verify Webhook is Working

### Option A: Test via Stripe Dashboard
1. Go to your webhook endpoint in Stripe Dashboard
2. Click **"Send test webhook"**
3. Select an event type (e.g., `checkout.session.completed`)
4. Click **"Send test webhook"**
5. Check the webhook logs to see if it was received successfully

### Option B: Make a Test Payment
1. Create a test booking and proceed to payment
2. Complete the payment using Stripe test card: `4242 4242 4242 4242`
3. Check your Vercel logs to see if the webhook was received
4. Verify that the payment status is updated to "succeeded" in your database

## Step 5: Monitor Webhook Events

1. In Stripe Dashboard → Webhooks → Your endpoint
2. View the **"Events"** tab to see all webhook attempts
3. Check for any failed deliveries (red status)
4. Review logs for any errors

## Troubleshooting

### Webhook Not Receiving Events
- ✅ Verify the webhook URL is correct and accessible
- ✅ Check that `STRIPE_WEBHOOK_SECRET` is set in Vercel environment variables
- ✅ Ensure you've redeployed after adding the environment variable
- ✅ Check Vercel function logs for errors

### Signature Verification Failed
- ✅ **CRITICAL**: Make sure the webhook URL in Stripe Dashboard matches exactly:
  ```
  https://taxigate-test-backend.vercel.app/api/payments/webhook
  ```
- ✅ Make sure you're using the **production** webhook secret (not the CLI one)
- ✅ The webhook secret must be from the **exact same endpoint** in Stripe Dashboard
- ✅ Verify the secret is correctly set in Vercel environment variables as `STRIPE_WEBHOOK_SECRET`
- ✅ **Redeploy** your Vercel app after adding/updating the webhook secret
- ✅ Check Vercel logs - the error will show if the secret prefix matches
- ✅ If you have multiple webhook endpoints in Stripe, make sure you're using the secret from the correct one
- ✅ The webhook secret format should be: `whsec_...` (starts with `whsec_`)

### Webhook Received But Payment Not Updated
- ✅ Check Vercel function logs for processing errors
- ✅ Verify database connection is working
- ✅ Check that the payment record exists in the database

## Important Notes

⚠️ **Never commit webhook secrets to Git**
- Webhook secrets are sensitive and should only be in environment variables

⚠️ **Different Secrets for Different Environments**
- Local development: Use Stripe CLI secret (`whsec_...` from `stripe listen`)
- Production: Use webhook secret from Stripe Dashboard

⚠️ **Vercel Function Timeout**
- Vercel serverless functions have a max duration (currently set to 30s in `vercel.json`)
- Webhook processing should complete within this time limit

## Webhook Events Handled

Your application handles these Stripe webhook events:

1. **`checkout.session.completed`**
   - Triggered when a checkout session is completed
   - Confirms payment and updates booking status

2. **`payment_intent.succeeded`**
   - Triggered when a payment intent succeeds
   - Updates payment status and booking

3. **`payment_intent.payment_failed`**
   - Triggered when a payment fails
   - Updates payment status to "failed"

