// scrapers/occ.js
// Pulls OCC (Office of the Comptroller of the Currency) news releases via RSS.
// OCC oversees national banks and federal savings associations.

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

const FEED_URL = 'https://www.occ.gov/tools-forms/rss/occ-news.rss';
const SOURCE   = 'OCC';

async function scrape() {
  try {
    const feed = await parser.parseURL(FEED_URL);
    return feed.items.map(item => ({
      source:      SOURCE,
      guid:        item.guid || item.link,
      title:       item.title?.trim() || 'Untitled Release',
      url:         item.link,
      description: item.contentSnippet || item.summary || '',
      publishedAt: item.pubDate || item.isoDate || null,
      category:    'Regulatory',
    }));
  } catch (err) {
    console.error(`[${SOURCE}] Scrape failed:`, err.message);
    return [];
  }
}

module.exports = { scrape, SOURCE };
