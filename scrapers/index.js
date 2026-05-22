// scrapers/index.js
// Runs all scrapers in parallel and returns a deduplicated list of new items
// after filtering against the database.

const cisa   = require('./cisa');
const nvd    = require('./nvd');
const occ    = require('./occ');
const fincen = require('./fincen');
const ffiec  = require('./ffiec');

const { filterNewItems, markItemsSent } = require('../db/database');

const ALL_SCRAPERS = [cisa, nvd, occ, fincen, ffiec];

async function runAllScrapers() {
  console.log('[Scrapers] Starting all scrapers...');

  const results = await Promise.allSettled(
    ALL_SCRAPERS.map(async s => {
      const items = await s.scrape();
      console.log(`[${s.SOURCE}] Fetched ${items.length} items`);
      return items;
    })
  );

  const allItems = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  console.log(`[Scrapers] Total raw items: ${allItems.length}`);

  // Filter out items we've already processed
  const newItems = filterNewItems(allItems);
  console.log(`[Scrapers] New items after dedup: ${newItems.length}`);

  return newItems;
}

// Call this AFTER successfully sending the newsletter to mark items as sent
function commitItems(items) {
  markItemsSent(items);
  console.log(`[Scrapers] Marked ${items.length} items as sent`);
}

module.exports = { runAllScrapers, commitItems };
