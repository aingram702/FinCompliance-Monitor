// templates/newsletter.js
// Generates the HTML and plain-text versions of the newsletter email.

const SOURCE_COLORS = {
  CISA:   '#e63946',
  NVD:    '#f4a261',
  OCC:    '#2a9d8f',
  FinCEN: '#264653',
  FFIEC:  '#6a4c93',
};

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : '#';
  } catch {
    return '#';
  }
}

function sourceBadge(source) {
  const color = SOURCE_COLORS[source] || '#888';
  return `<span style="background:${color};color:#fff;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.5px;font-family:monospace;">${escHtml(source)}</span>`;
}

function renderItem(item) {
  const url   = safeUrl(item.url);
  const title = escHtml(item.title);
  const urgentBanner = item.urgent
    ? `<div style="background:#fff3cd;border-left:4px solid #e63946;padding:8px 12px;margin-bottom:10px;font-size:13px;color:#7a2020;font-weight:600;">&#9888;&#65039; URGENT — Immediate attention recommended</div>`
    : '';

  return `
    <div style="background:#fff;border:1px solid #e8e8e8;border-radius:6px;padding:20px;margin-bottom:16px;">
      ${urgentBanner}
      <div style="margin-bottom:8px;">
        ${sourceBadge(item.source)}
      </div>
      <h3 style="margin:8px 0;font-size:15px;color:#1a1a2e;">
        <a href="${url}" style="color:#1a1a2e;text-decoration:none;">${title}</a>
      </h3>
      <p style="margin:8px 0;font-size:14px;color:#444;line-height:1.6;">${escHtml(item.summary)}</p>
      <div style="background:#f4f7fb;border-radius:4px;padding:10px 14px;margin-top:10px;">
        <strong style="font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Action Required</strong>
        <p style="margin:4px 0 0;font-size:13px;color:#333;">${escHtml(item.actionRequired)}</p>
      </div>
      <div style="margin-top:10px;">
        <a href="${url}" style="font-size:12px;color:#2563eb;">Read full advisory &rarr;</a>
      </div>
    </div>`;
}

function renderSection(section) {
  if (!section.items || section.items.length === 0) return '';
  return `
    <div style="margin-bottom:30px;">
      <h2 style="font-size:18px;color:#fff;background:#1a1a2e;padding:10px 16px;border-radius:4px;margin:0 0 16px 0;">
        ${escHtml(section.title)}
      </h2>
      ${section.items.map(renderItem).join('')}
    </div>`;
}

/**
 * Builds the full HTML email body.
 * @param {Object} newsletter - Structured newsletter from Claude
 * @param {string} unsubscribeUrl
 * @param {string} appUrl
 */
function buildHtml(newsletter, unsubscribeUrl, appUrl) {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const urgentCount = newsletter.sections
    .flatMap(s => s.items)
    .filter(i => i.urgent).length;

  const urgentBanner = urgentCount > 0
    ? `<div style="background:#e63946;color:#fff;text-align:center;padding:12px;font-weight:700;font-size:14px;letter-spacing:0.5px;">
        &#9888;&#65039; ${urgentCount} URGENT ITEM${urgentCount > 1 ? 'S' : ''} IN THIS BRIEFING
       </div>`
    : '';

  const safeUnsubUrl = safeUrl(unsubscribeUrl);
  const safeAppUrl   = safeUrl(appUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(newsletter.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:24px auto;background:#f0f2f5;">

    <!-- Header -->
    <div style="background:#1a1a2e;padding:24px 32px;border-radius:8px 8px 0 0;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div>
          <h1 style="margin:0;font-size:22px;color:#fff;font-weight:700;">&#127974; FinCompliance Monitor</h1>
          <p style="margin:4px 0 0;font-size:13px;color:#8fa3bf;">${escHtml(date)}</p>
        </div>
      </div>
    </div>

    ${urgentBanner}

    <!-- Editor's Take -->
    <div style="background:#16213e;padding:20px 32px;">
      <p style="margin:0 0 6px;font-size:11px;color:#8fa3bf;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Editor's Take</p>
      <p style="margin:0;font-size:15px;color:#e2e8f0;line-height:1.7;">${escHtml(newsletter.editorsTake)}</p>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px 8px;background:#f0f2f5;">
      ${newsletter.sections.map(renderSection).join('')}

      <!-- Closing Note -->
      <div style="background:#e8f0fe;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 6px 6px 0;margin-bottom:24px;">
        <strong style="font-size:13px;color:#1a1a2e;">Looking Ahead</strong>
        <p style="margin:6px 0 0;font-size:14px;color:#333;">${escHtml(newsletter.closingNote)}</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#1a1a2e;padding:20px 32px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0 0 8px;font-size:12px;color:#8fa3bf;">
        You're receiving this because you subscribed to FinCompliance Monitor.
      </p>
      <p style="margin:0;font-size:12px;">
        <a href="${safeAppUrl}" style="color:#60a5fa;text-decoration:none;">Manage Subscription</a>
        &nbsp;&middot;&nbsp;
        <a href="${safeUnsubUrl}" style="color:#60a5fa;text-decoration:none;">Unsubscribe</a>
      </p>
      <p style="margin:12px 0 0;font-size:11px;color:#4a5568;">
        FinCompliance Monitor &middot; Not legal or compliance advice &middot; Always consult your legal counsel.
      </p>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Builds a plain-text fallback version.
 */
function buildText(newsletter) {
  const date = new Date().toDateString();
  let text = `FINCOMPLIANCE MONITOR — ${date}\n`;
  text += `${'='.repeat(60)}\n\n`;
  text += `EDITOR'S TAKE\n${newsletter.editorsTake}\n\n`;

  for (const section of newsletter.sections) {
    text += `\n${section.title.toUpperCase()}\n${'-'.repeat(section.title.length)}\n`;
    for (const item of section.items) {
      text += `\n${item.urgent ? 'URGENT: ' : ''}[${item.source}] ${item.title}\n`;
      text += `${item.summary}\n`;
      text += `Action: ${item.actionRequired}\n`;
      text += `Link: ${item.url}\n`;
    }
  }

  text += `\nLOOKING AHEAD\n${newsletter.closingNote}\n`;
  text += `\n${'='.repeat(60)}\n`;
  text += `FinCompliance Monitor. Not legal or compliance advice.\n`;
  return text;
}

module.exports = { buildHtml, buildText };
