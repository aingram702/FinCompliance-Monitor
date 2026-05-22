// scrapers/fincen.js
// Pulls FinCEN (Financial Crimes Enforcement Network) news and advisories.
// Critical for AML/BSA compliance monitoring.

const Parser = require('rss-parser');
const axios  = require('axios');
const parser = new Parser({ timeout: 10000 });

const SOURCE = 'FinCEN';

// FinCEN RSS feeds
const FEEDS = [
  {
    url:      'https://www.fincen.gov/news-room/news-releases/feed',
    category: 'News Release',
  },
  {
    url:      'https://www.fincen.gov/resources/advisories/feed',
    category: 'Advisory',
  },
];

async function scrapeFeed({ url, category }) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      source:      SOURCE,
      guid:        item.guid || item.link,
      title:       item.title?.trim() || 'Untitled',
      url:         item.link,
      description: item.contentSnippet || item.summary || '',
      publishedAt: item.pubDate || item.isoDate || null,
      category,
    }));
  } catch (err) {
    console.warn(`[${SOURCE}] Feed ${url} failed:`, err.message);
    return [];
  }
}

async function scrape() {
  const results = await Promise.allSettled(FEEDS.map(scrapeFeed));
  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicate by guid within this batch
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.guid)) return false;
    seen.add(item.guid);
    return true;
  });
}

module.exports = { scrape, SOURCE };
