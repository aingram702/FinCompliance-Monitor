// scrapers/fed.js
// Pulls Federal Reserve press releases.
// Critical for financial institutions: interest rate decisions, supervisory guidance,
// bank applications, enforcement actions, and regulatory updates.

const Parser = require('rss-parser');
const axios  = require('axios');
const parser = new Parser({
  timeout: 10000,
  customFields: { item: ['description', 'content:encoded'] },
});

const SOURCE = 'FED';

const FEED_URL     = 'https://www.federalreserve.gov/feeds/press_all.xml';
const FALLBACK_URL = 'https://www.federalreserve.gov/newsevents/pressreleases.htm';

async function scrapeRss() {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.map(item => ({
    source:      SOURCE,
    guid:        item.guid || item.link,
    title:       item.title?.trim() || 'Untitled',
    url:         item.link,
    description: item.contentSnippet || item['content:encoded'] || item.description || '',
    publishedAt: item.pubDate || item.isoDate || null,
    category:    'Monetary Policy / Supervision',
  }));
}

async function scrapeFallback() {
  const response = await axios.get(FALLBACK_URL, { timeout: 10000 });
  const html = response.data;
  const items = [];
  const linkRe = /<a\s+[^>]*href="(\/newsevents\/pressreleases\/[^"]+\.htm)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const href  = match[1].trim();
    const title = match[2].trim();
    if (!title || title.length < 10) continue;
    const rawUrl = `https://www.federalreserve.gov${href}`;
    let url;
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      url = rawUrl;
    } catch {
      continue;
    }
    items.push({
      source:      SOURCE,
      guid:        url,
      title,
      url,
      description: '',
      publishedAt: null,
      category:    'Monetary Policy / Supervision',
    });
  }
  return items.slice(0, 20);
}

async function scrape() {
  try {
    return await scrapeRss();
  } catch (err) {
    console.warn(`[${SOURCE}] RSS failed, trying fallback:`, err.message);
    try {
      return await scrapeFallback();
    } catch (fallbackErr) {
      console.error(`[${SOURCE}] Fallback also failed:`, fallbackErr.message);
      return [];
    }
  }
}

module.exports = { scrape, SOURCE };
