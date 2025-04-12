// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();


app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Parse JSON request bodies
app.use(express.json());

// Webhook handling - must come before JSON body parser
app.use(
  '/api/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle specific events
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        console.log(`Subscription status: ${subscription.status} for ID: ${subscription.id}`);
        // Update your database based on subscription status
        break;
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
        const invoice = event.data.object;
        console.log(`Invoice ${invoice.id} status: ${invoice.status}`);
        // Handle successful or failed payments
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  }
);

/**
 * API 1: Create Payment Session
 * Creates a payment intent for subscription initiation
 */
// app.post('/api/create-payment-session', async (req, res) => {
//   try {
//     const { customerId, priceId } = req.body;
    
//     if (!customerId || !priceId) {
//       return res.status(400).json({ 
//         error: 'Missing required parameters: customerId and priceId are required' 
//       });
//     }
    
//     // Get the price details to determine amount and currency
//     const price = await stripe.prices.retrieve(priceId);
    
//     // Create a payment intent
//     const paymentIntent = await stripe.paymentIntents.create({
//       amount: price.unit_amount,
//       currency: price.currency,
//       customer: customerId,
//       setup_future_usage: 'off_session', // Store payment method for future subscription charges
//       metadata: {
//         priceId: priceId,
//         subscriptionType: price.nickname || 'Default Plan'
//       }
//     });
    
//     // Return the client secret to the frontend
//     res.status(200).json({
//       success: true,
//       clientSecret: paymentIntent.client_secret,
//       paymentIntentId: paymentIntent.id,
//       amount: price.unit_amount,
//       currency: price.currency
//     });
//   } catch (error) {
//     console.error('Error creating payment session:', error);
//     res.status(500).json({ 
//       error: error.message || 'An error occurred while creating the payment session'
//     });
//   }
// });

app.post('/api/create-payment-session', async (req, res) => {
    const { priceId, customerId } = req.body;
  
    if (!priceId) {
      return res.status(400).json({ error: "Missing priceId" });
    }
  
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        customer: customerId, // optional if you want to link it
        success_url: 'https://emails-signature.netlify.app/payment',
        cancel_url: 'http://localhost:3000/cancel',
      });
  
      res.status(200).json({ url: session.url });
    } catch (error) {
      console.error('Stripe Checkout error:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
/**
 * API 2: Confirm Subscription
 * Confirms payment was successful and creates the subscription
 */
app.post('/api/confirm-subscription', async (req, res) => {
  try {
    const { paymentIntentId, customerId, priceId, paymentMethodId } = req.body;
    
    if (!paymentIntentId || !customerId || !priceId || !paymentMethodId) {
      return res.status(400).json({ 
        error: 'Missing required parameters' 
      });
    }
    
    // Verify payment intent was successful
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: `Payment not successful. Current status: ${paymentIntent.status}`
      });
    }
    
    // Set payment method as default for the customer
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });
    
    // Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      expand: ['latest_invoice']
    });
    
    res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      invoiceUrl: subscription.latest_invoice.hosted_invoice_url || null
    });
  } catch (error) {
    console.error('Error confirming subscription:', error);
    res.status(500).json({ 
      error: error.message || 'An error occurred while confirming the subscription'
    });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Using Stripe API version: ${stripe.getApiField('version')}`);
});

module.exports = app; // For testing purposes