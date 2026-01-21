require('dotenv').config();
const axios = require('axios');

const SESSION_ID = process.argv[2] || 'cs_test_example';

const testWebhook = {
  id: 'evt_test_webhook',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: SESSION_ID,
      object: 'checkout.session',
      payment_status: 'paid',
      status: 'complete',
      customer_email: 'test@example.com',
      amount_total: 10000, 
      currency: 'eur',
      metadata: {
        bookingId: 'test_booking_id'
      }
    }
  }
};

async function testWebhookEndpoint() {
  try {
    console.log('Testing webhook endpoint...');
    console.log('Sending test webhook event...');
    
    const response = await axios.post('http://localhost:5000/api/payments/webhook', testWebhook, {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'test_signature' 
      }
    });
    
    console.log('Webhook endpoint is reachable!');
    console.log('Response:', response.data);
  } catch (error) {
    if (error.response) {
      console.log('Webhook endpoint responded (expected signature error):');
      console.log('Status:', error.response.status);
      console.log('Response:', error.response.data);
    } else {
      console.error('Error:', error.message);
      console.log('\nMake sure your server is running on port 5000');
    }
  }
}

testWebhookEndpoint();

