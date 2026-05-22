// scrapers/cisa.js
// Pulls from CISA's cybersecurity advisory RSS feed.
// Source: https://www.cisa.gov/feeds/alerts.xml

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

const FEED_URL = 'https://www.cisa.gov/feeds/alerts.xml';
const SOURCE   = 'CISA';

async function scrape() {
  try {
    const feed = await parser.parseURL(FEED_URL);
    return feed.items.map(item => ({
      source:      SOURCE,
      guid:        item.guid || item.link,
      title:       item.title?.trim() || 'Untitled Advisory',
      url:         item.link,
      description: item.contentSnippet || item.summary || item.content || '',
      publishedAt: item.pubDate || item.isoDate || null,
      category:    item.categories?.[0] || 'Advisory',
    }));
  } catch (err) {
    console.error(`[${SOURCE}] Scrape failed:`, err.message);
    return [];
  }
}

module.exports = { scrape, SOURCE };
