// scrapers/ffiec.js
// Pulls FFIEC (Federal Financial Institutions Examination Council) press releases.
// FFIEC coordinates examination policies for federal financial institution regulators.

const Parser = require('rss-parser');
const axios  = require('axios');
const parser = new Parser({
  timeout: 10000,
  customFields: { item: ['description', 'content:encoded'] },
});

const SOURCE = 'FFIEC';

// FFIEC press releases RSS
const FEED_URL = 'https://www.ffiec.gov/rss/press.aspx';

// Fallback: scrape their press release page if RSS is down
const FALLBACK_URL = 'https://www.ffiec.gov/press/press_releases.htm';

async function scrapeRss() {
  const feed = await parser.parseURL(FEED_URL);
  return feed.items.map(item => ({
    source:      SOURCE,
    guid:        item.guid || item.link,
    title:       item.title?.trim() || 'Untitled',
    url:         item.link,
    description: item.contentSnippet || item['content:encoded'] || item.description || '',
    publishedAt: item.pubDate || item.isoDate || null,
    category:    'Interagency',
  }));
}

async function scrapeFallback() {
  // Lightweight HTML parse using regex on the press release list page
  const response = await axios.get(FALLBACK_URL, { timeout: 10000 });
  const html = response.data;

  const items = [];
  // Match anchor tags in the press release list
  const linkRe = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const href  = match[1];
    const title = match[2].trim();
    if (!href.includes('press_releases') && !href.includes('nr')) continue;
    const url = href.startsWith('http') ? href : `https://www.ffiec.gov${href}`;
    items.push({
      source:      SOURCE,
      guid:        url,
      title,
      url,
      description: '',
      publishedAt: null,
      category:    'Interagency',
    });
  }
  return items.slice(0, 20); // Cap at 20 most recent
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
