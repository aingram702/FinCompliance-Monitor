// server.js
// Express server handling:
//  - Stripe checkout session creation
//  - Stripe webhooks (subscription lifecycle)
//  - Subscriber unsubscribe route
//  - Admin health check

require('dotenv').config();  // must load env before any SDK init

const REQUIRED_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID_BASIC'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  upsertSubscriber,
  getSubscriberByToken,
  getSubscriberByStripeCustomer,
  setSubscriberStatus,
  getActiveSubscribers,
  hasProcessedStripeEvent,
  recordStripeEvent,
  getNewsletterHistory,
} = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
const _rateLimitMap = new Map();
const RATE_LIMIT    = 5;           // max requests per window per IP
const RATE_WINDOW   = 60 * 1000;  // 1 minute

function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = _rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    _rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Periodically purge expired rate-limit entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW) _rateLimitMap.delete(ip);
  }
}, RATE_WINDOW).unref();

// ── Stripe webhooks need raw body ──────────────────────────────────────────────
app.post(
  '/stripe/webhook',
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
      console.error('[Stripe] Webhook signature verification failed:', err.message);
      return res.status(400).send('Webhook Error: invalid signature');
    }

    console.log(`[Stripe] Event: ${event.type}`);

    // Idempotency: skip events we've already handled
    if (hasProcessedStripeEvent(event.id)) {
      console.log(`[Stripe] Duplicate event skipped: ${event.id}`);
      return res.json({ received: true });
    }

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object;
          if (session.mode !== 'subscription') break;

          const customer = await stripe.customers.retrieve(session.customer);
          const sub      = await stripe.subscriptions.retrieve(session.subscription);
          const priceId  = sub.items.data[0]?.price?.id;
          const tier     = priceId === process.env.STRIPE_PRICE_ID_PRO ? 'pro' : 'basic';

          upsertSubscriber({
            email:                customer.email,
            stripeCustomerId:     session.customer,
            stripeSubscriptionId: session.subscription,
            status:               'active',
            tier,
          });
          console.log(`[Stripe] New subscriber: ${customer.email} (${tier})`);
          break;
        }

        case 'customer.subscription.deleted': {
          const sub      = event.data.object;
          const customer = await stripe.customers.retrieve(sub.customer);
          setSubscriberStatus(customer.email, 'cancelled');
          console.log(`[Stripe] Cancelled: ${customer.email}`);
          break;
        }

        case 'customer.subscription.updated': {
          const sub = event.data.object;
          if (['past_due', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
            const customer = await stripe.customers.retrieve(sub.customer);
            setSubscriberStatus(customer.email, 'suspended');
            console.log(`[Stripe] Suspended (payment issue): ${customer.email}`);
          }
          if (sub.status === 'active') {
            const customer = await stripe.customers.retrieve(sub.customer);
            setSubscriberStatus(customer.email, 'active');
            console.log(`[Stripe] Reactivated: ${customer.email}`);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const inv      = event.data.object;
          const customer = await stripe.customers.retrieve(inv.customer);
          console.warn(`[Stripe] Payment failed for ${customer.email}`);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Stripe] Error handling event:', err.message);
      return res.status(500).json({ error: 'Internal error processing event' });
    }

    recordStripeEvent(event.id, event.type);
    res.json({ received: true });
  }
);

// ── JSON body parsing for all other routes ─────────────────────────────────────
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// ── Create Stripe Checkout Session ────────────────────────────────────────────
app.post('/subscribe', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  const { email, tier: rawTier } = req.body;
  const tier = rawTier === 'pro' ? 'pro' : 'basic';

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const priceId = tier === 'pro'
    ? process.env.STRIPE_PRICE_ID_PRO
    : process.env.STRIPE_PRICE_ID_BASIC;

  if (!priceId) {
    return res.status(500).json({ error: 'Subscription tier not configured' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                 'subscription',
      customer_email:       email,
      line_items: [{
        price:    priceId,
        quantity: 1,
      }],
      success_url: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/cancel`,
      metadata: { tier },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('[Subscribe] Stripe error:', err.message);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// ── Unsubscribe ────────────────────────────────────────────────────────────────
app.get('/unsubscribe', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).send('Too many requests — try again later.');
  }

  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.length > 128) {
    return res.status(400).send('Invalid unsubscribe link.');
  }

  const subscriber = getSubscriberByToken(token);
  if (!subscriber) return res.status(404).send('Subscription not found.');

  setSubscriberStatus(subscriber.email, 'unsubscribed');
  console.log(`[Unsubscribe] ${subscriber.email}`);

  res.send(`
    <!DOCTYPE html><html><head><title>Unsubscribed</title>
    <style>body{font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center;}</style>
    </head><body>
    <h2>You've been unsubscribed.</h2>
    <p>You will no longer receive FinCompliance Monitor briefings.</p>
    <p style="font-size:13px;color:#888;">If this was a mistake, reply to any past briefing email and we'll re-activate your subscription.</p>
    </body></html>
  `);
});

// ── Success / Cancel pages ─────────────────────────────────────────────────────
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html><html><head><title>Subscribed!</title>
    <style>body{font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center;}</style>
    </head><body>
    <h2>You're subscribed!</h2>
    <p>Your first FinCompliance Monitor briefing will arrive on the next scheduled send.</p>
    </body></html>
  `);
});

app.get('/cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html><html><head><title>Cancelled</title>
    <style>body{font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center;}</style>
    </head><body>
    <h2>Checkout cancelled.</h2>
    <p>No charge was made. <a href="/">Try again</a>.</p>
    </body></html>
  `);
});

// ── Admin auth middleware ──────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_SECRET_KEY;
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Admin: subscriber stats ────────────────────────────────────────────────────
app.get('/admin/stats', requireAdmin, (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  const subscribers = getActiveSubscribers();
  res.json({
    activeSubscribers: subscribers.length,
    tiers: {
      basic: subscribers.filter(s => s.tier === 'basic').length,
      pro:   subscribers.filter(s => s.tier === 'pro').length,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Admin: newsletter history ─────────────────────────────────────────────────
app.get('/admin/newsletters', requireAdmin, (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json({ newsletters: getNewsletterHistory(limit) });
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});

module.exports = app;
