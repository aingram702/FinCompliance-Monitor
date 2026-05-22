// mailer/sender.js
// Sends the newsletter to all active subscribers via Resend.
// Each subscriber gets a personalized unsubscribe link.

const { Resend } = require('resend');
const { buildHtml, buildText, buildDigestHtml, buildDigestText } = require('../templates/newsletter');
const { saveNewsletter, logSend } = require('../db/database');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'briefings@yourdomain.com';
const FROM_NAME  = process.env.FROM_NAME  || 'FinCompliance Monitor';
const APP_URL    = process.env.APP_URL    || 'https://yourdomain.com';

// Resend free tier rate limit: 2 req/sec. Add a small delay between sends.
const SEND_DELAY_MS = 600;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send newsletter to a single subscriber (pro = full, basic = digest).
 */
async function sendToOne(subscriber, newsletter, proHtmlTemplate, proTextBody, digestHtmlTemplate, digestTextBody) {
  const unsubUrl = `${APP_URL}/unsubscribe?token=${subscriber.unsubscribe_token}`;
  const isPro    = subscriber.tier === 'pro';
  const template = isPro ? proHtmlTemplate : digestHtmlTemplate;
  const textBody = isPro ? proTextBody     : digestTextBody;
  const html     = template.replace(/UNSUBSCRIBE_URL_PLACEHOLDER/g, unsubUrl);

  try {
    await resend.emails.send({
      from:    `${FROM_NAME} <${FROM_EMAIL}>`,
      to:      subscriber.email,
      subject: newsletter.subject,
      html,
      text:    textBody,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    return { success: true };
  } catch (err) {
    console.error(`[Mailer] Failed to send to ${subscriber.email}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send newsletter to all active subscribers.
 * @param {Object} newsletter - Structured newsletter from Claude
 * @param {Array}  subscribers - Active subscribers from DB
 * @param {number} itemCount - Number of source items included
 */
async function sendNewsletter(newsletter, subscribers, itemCount) {
  if (!subscribers || subscribers.length === 0) {
    console.log('[Mailer] No active subscribers to send to.');
    return;
  }

  // Build both full and digest templates once (placeholder replaced per subscriber)
  const proHtmlTemplate    = buildHtml(newsletter, 'UNSUBSCRIBE_URL_PLACEHOLDER', APP_URL);
  const proTextBody        = buildText(newsletter);
  const digestHtmlTemplate = buildDigestHtml(newsletter, 'UNSUBSCRIBE_URL_PLACEHOLDER', APP_URL);
  const digestTextBody     = buildDigestText(newsletter);

  const proCount   = subscribers.filter(s => s.tier === 'pro').length;
  const basicCount = subscribers.length - proCount;
  console.log(`[Mailer] Sending to ${subscribers.length} subscriber(s) — Pro: ${proCount}, Basic: ${basicCount}`);

  // Save newsletter record (store full version as canonical)
  const record = saveNewsletter({
    subject:        newsletter.subject,
    htmlBody:       proHtmlTemplate,
    textBody:       proTextBody,
    itemCount,
    recipientCount: subscribers.length,
  });

  let sent = 0, failed = 0;

  for (let i = 0; i < subscribers.length; i++) {
    const subscriber = subscribers[i];
    const result = await sendToOne(subscriber, newsletter, proHtmlTemplate, proTextBody, digestHtmlTemplate, digestTextBody);
    logSend(record.id, subscriber.id, subscriber.email, result.success ? 'sent' : 'failed');

    if (result.success) {
      sent++;
      console.log(`[Mailer] ✓ Sent to ${subscriber.email}`);
    } else {
      failed++;
    }

    if (i < subscribers.length - 1) {
      await sleep(SEND_DELAY_MS);
    }
  }

  console.log(`[Mailer] Done. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed, newsletterId: record.id };
}

module.exports = { sendNewsletter };
