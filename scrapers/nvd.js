// scrapers/nvd.js
// Pulls recent high/critical CVEs from NIST's National Vulnerability Database API v2.
// Filters to CVSS >= 7.0 so we only surface meaningful vulns.
// API docs: https://nvd.nist.gov/developers/vulnerabilities

const axios = require('axios');
require('dotenv').config();

const SOURCE   = 'NVD';
const BASE_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const MIN_CVSS  = 7.0; // High and Critical only
const LOOK_BACK_HOURS = 72; // Pull last 72 hours to account for weekend gaps

function getDateRange() {
  const end   = new Date();
  const start = new Date(end.getTime() - LOOK_BACK_HOURS * 60 * 60 * 1000);
  return {
    pubStartDate: start.toISOString().replace('.000Z', '.000'),
    pubEndDate:   end.toISOString().replace('.000Z', '.000'),
  };
}

function getCvssScore(cve) {
  // Try v3.1, v3.0, then v2.0
  const metrics = cve.metrics;
  if (metrics?.cvssMetricV31?.[0])  return metrics.cvssMetricV31[0].cvssData.baseScore;
  if (metrics?.cvssMetricV30?.[0])  return metrics.cvssMetricV30[0].cvssData.baseScore;
  if (metrics?.cvssMetricV2?.[0])   return metrics.cvssMetricV2[0].cvssData.baseScore;
  return null;
}

function getSeverityLabel(score) {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  return 'LOW';
}

async function scrape() {
  try {
    const { pubStartDate, pubEndDate } = getDateRange();
    const headers = {};
    if (process.env.NVD_API_KEY) {
      headers['apiKey'] = process.env.NVD_API_KEY;
    }

    const response = await axios.get(BASE_URL, {
      headers,
      params: {
        pubStartDate,
        pubEndDate,
        cvssV3Severity: 'HIGH',  // Pre-filter on server side
        resultsPerPage: 50,
      },
      timeout: 15000,
    });

    const vulnerabilities = response.data?.vulnerabilities || [];

    return vulnerabilities
      .map(({ cve }) => {
        const score = getCvssScore(cve);
        const description = cve.descriptions?.find(d => d.lang === 'en')?.value || '';
        const severity = score ? getSeverityLabel(score) : 'UNKNOWN';
        return {
          source:      SOURCE,
          guid:        cve.id,
          title:       `[${severity} ${score ?? '?'}] ${cve.id}`,
          url:         `https://nvd.nist.gov/vuln/detail/${cve.id}`,
          description,
          publishedAt: cve.published || null,
          category:    'Vulnerability',
          cvssScore:   score,
          severity,
          cveId:       cve.id,
        };
      })
      .filter(item => item.cvssScore === null || item.cvssScore >= MIN_CVSS);

  } catch (err) {
    console.error(`[${SOURCE}] Scrape failed:`, err.message);
    return [];
  }
}

module.exports = { scrape, SOURCE };
