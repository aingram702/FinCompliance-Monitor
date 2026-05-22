// scrapers/sec.js
// Pulls SEC (Securities and Exchange Commission) press releases.
// Relevant to financial institutions: enforcement actions, no-action letters,
// new rules affecting broker-dealers, investment advisers, and public companies.

const Parser = require('rss-parser');
const axios  = require('axios');
const parser = new Parser({
  timeout: 10000,
  customFields: { item: ['description', 'content:encoded'] },
});

const SOURCE = 'SEC';

const FEED_URL    = 'https://www.sec.gov/rss/news/press.rss';
const FALLBACK_URL = 'https://www.sec.gov/newsroom/press-releases';

async function scrapeRss() {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.map(item => ({
    source:      SOURCE,
    guid:        item.guid || item.link,
    title:       item.title?.trim() || 'Untitled',
    url:         item.link,
    description: item.contentSnippet || item['content:encoded'] || item.description || '',
    publishedAt: item.pubDate || item.isoDate || null,
    category:    'Enforcement / Rulemaking',
  }));
}

async function scrapeFallback() {
  const response = await axios.get(FALLBACK_URL, { timeout: 10000 });
  const html = response.data;
  const items = [];
  const linkRe = /<a\s+[^>]*href="([^"]*\/news\/press-releases\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const href  = match[1].trim();
    const title = match[2].trim();
    if (!title || title.length < 10) continue;
    const rawUrl = href.startsWith('http') ? href : `https://www.sec.gov${href}`;
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
      category:    'Enforcement / Rulemaking',
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
