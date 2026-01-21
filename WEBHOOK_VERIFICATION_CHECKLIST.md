# Webhook Secret Verification Checklist

## Current Status
- ✅ Raw body is being captured correctly (Buffer, ~3944 bytes)
- ✅ Webhook secret format is correct (starts with `whsec_`)
- ✅ Signature header is present
- ❌ Signature verification is failing

## This means: The webhook secret in Vercel doesn't match the endpoint in Stripe

## Step-by-Step Fix:

### Step 1: Check Stripe Dashboard
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Look for an endpoint with URL: `https://taxigate-test-backend.vercel.app/api/payments/webhook`
3. **If the endpoint doesn't exist:**
   - Click "Add endpoint"
   - Enter URL: `https://taxigate-test-backend.vercel.app/api/payments/webhook`
   - Select events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Click "Add endpoint"

### Step 2: Get the Correct Signing Secret
1. Click on the endpoint you found/created in Step 1
2. Scroll to "Signing secret" section
3. Click "Reveal" or "Click to reveal"
4. Copy the ENTIRE secret (it starts with `whsec_` and is about 40-50 characters)
5. **IMPORTANT:** This is the SIGNING SECRET, NOT the endpoint ID (which starts with `we_`)

### Step 3: Verify Vercel Environment Variable
1. Go to: https://vercel.com/dashboard
2. Select your project: `taxigate-test-backend`
3. Go to: Settings → Environment Variables
4. Find `STRIPE_WEBHOOK_SECRET`
5. **Compare it with the secret from Step 2:**
   - They must match EXACTLY (character for character)
   - Both should start with `whsec_`
   - Both should be about the same length

### Step 4: If They Don't Match
1. Click "Edit" on `STRIPE_WEBHOOK_SECRET` in Vercel
2. Delete the old value
3. Paste the secret from Step 2
4. Make sure "Production" environment is selected
5. Click "Save"
6. **CRITICAL:** Redeploy your application
   - Go to Deployments tab
   - Click the three dots on the latest deployment
   - Click "Redeploy"

### Step 5: Verify After Redeploy
1. Wait for deployment to complete
2. Go back to Stripe Dashboard → Your webhook endpoint
3. Click "Send test webhook"
4. Select an event (e.g., `checkout.session.completed`)
5. Click "Send test webhook"
6. Check Vercel logs - you should see: `✅ Event verified successfully`

## Common Mistakes:

❌ **Using endpoint ID instead of signing secret**
- Endpoint ID starts with `we_`
- Signing secret starts with `whsec_`
- You need the SIGNING SECRET

❌ **Using CLI secret from `stripe listen`**
- CLI secrets are for local testing only
- Production needs the secret from Stripe Dashboard

❌ **Using secret from wrong endpoint**
- If you have multiple endpoints, make sure you're using the secret from the endpoint with URL: `https://taxigate-test-backend.vercel.app/api/payments/webhook`

❌ **Not redeploying after updating secret**
- Vercel caches environment variables
- You MUST redeploy for changes to take effect

❌ **URL mismatch**
- The URL in Stripe must be EXACTLY: `https://taxigate-test-backend.vercel.app/api/payments/webhook`
- No trailing slash
- Must use `https://` not `http://`
- Must match the domain exactly

## Still Not Working?

If you've verified all the above and it's still failing:

1. **Check Vercel logs** for the secret prefix (first 15 characters)
2. **Check Stripe Dashboard** for the secret prefix from your endpoint
3. **They should match** - if they don't, you're using the wrong secret

## Test Command (for debugging):

You can verify the secret format in Vercel logs:
- Look for: `secretPrefix: 'whsec_...'`
- This should match the first part of your Stripe signing secret

