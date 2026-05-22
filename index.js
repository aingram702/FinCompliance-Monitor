// index.js
// Main entry point. Runs the full pipeline on a cron schedule:
//   1. Scrape all sources
//   2. Filter new items
//   3. Generate newsletter via Claude
//   4. Send to all active subscribers via Resend
//   5. Mark items as sent in DB
//
// Run:          node index.js           (starts cron scheduler)
// Manual run:   node index.js --now     (runs pipeline immediately, then exits)

require('dotenv').config();
const cron = require('node-cron');

const { runAllScrapers, commitItems } = require('./scrapers');
const { generateNewsletter }          = require('./agent/summarizer');
const { sendNewsletter }              = require('./mailer/sender');
const { getActiveSubscribers }        = require('./db/database');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 7 * * 1,3,5'; // Mon/Wed/Fri at 7am

// ── Pipeline ───────────────────────────────────────────────────────────────────

async function runPipeline() {
  const start = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log(`[Pipeline] Starting at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  try {
    // Step 1: Scrape
    const newItems = await runAllScrapers();

    if (newItems.length === 0) {
      console.log('[Pipeline] No new items found. Skipping newsletter send.');
      return;
    }

    // Step 2: Get subscribers
    const subscribers = getActiveSubscribers();
    if (subscribers.length === 0) {
      console.log('[Pipeline] No active subscribers. Marking items as seen and stopping.');
      commitItems(newItems);
      return;
    }

    console.log(`[Pipeline] ${subscribers.length} active subscriber(s)`);

    // Step 3: Generate newsletter via Claude
    const newsletter = await generateNewsletter(newItems);
    if (!newsletter) {
      console.error('[Pipeline] Newsletter generation returned null. Aborting.');
      return;
    }

    // Step 4: Send
    const result = await sendNewsletter(newsletter, subscribers, newItems.length);

    // Step 5: Commit items only after successful send
    // (if send completely failed we'd want to retry next run)
    if (result && result.sent > 0) {
      commitItems(newItems);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n[Pipeline] ✅ Complete in ${elapsed}s — Sent: ${result?.sent}, Failed: ${result?.failed}`);

  } catch (err) {
    console.error('[Pipeline] ❌ Fatal error:', err.message);
    console.error(err.stack);
  }
}

// ── Entrypoint ─────────────────────────────────────────────────────────────────

const runNow = process.argv.includes('--now');

if (runNow) {
  // One-shot manual execution (useful for testing)
  console.log('[Scheduler] --now flag detected: running pipeline immediately...');
  runPipeline().then(() => {
    console.log('[Scheduler] One-shot run complete. Exiting.');
    process.exit(0);
  });
} else {
  // Validate cron expression
  if (!cron.validate(CRON_SCHEDULE)) {
    console.error(`[Scheduler] Invalid cron expression: "${CRON_SCHEDULE}"`);
    process.exit(1);
  }

  console.log(`[Scheduler] FinCompliance Monitor started.`);
  console.log(`[Scheduler] Schedule: "${CRON_SCHEDULE}"`);
  console.log(`[Scheduler] Next run: ${getNextRun(CRON_SCHEDULE)}`);

  cron.schedule(CRON_SCHEDULE, () => {
    runPipeline();
  });

  // Keep the process alive
  process.on('SIGINT',  () => { console.log('\n[Scheduler] Shutting down.'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n[Scheduler] Shutting down.'); process.exit(0); });
}

function getNextRun(cronExpr) {
  // Quick human-readable hint (not a full cron parser)
  const parts = cronExpr.split(' ');
  return `minute ${parts[0]}, hour ${parts[1]}, days ${parts[4]} of the week`;
}
