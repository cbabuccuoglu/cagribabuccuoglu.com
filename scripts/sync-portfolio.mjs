import { readFile, writeFile } from 'node:fs/promises';

const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
const spreadsheetRange = 'A1:D1000';
const startMarker = '<!-- SHEET_PROJECTS_START -->';
const endMarker = '<!-- SHEET_PROJECTS_END -->';
const portfolioPath = new URL('../portfolio.html', import.meta.url);

const apiKey = process.env.SHEETS_API_KEY;
const referrer = process.env.SHEETS_API_REFERER;

if (!apiKey) {
  throw new Error('Missing SHEETS_API_KEY. Add it as a GitHub Actions repository secret.');
}

if (!spreadsheetId || !/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
  throw new Error('Missing or invalid SHEETS_SPREADSHEET_ID. Add it as a GitHub Actions repository variable.');
}

if (!referrer) {
  throw new Error('Missing SHEETS_API_REFERER. Set it to an allowed website referrer.');
}

const url = new URL(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(spreadsheetRange)}`,
);
url.searchParams.set('key', apiKey);

const response = await fetch(url, { headers: { referer: referrer } });
const payload = await response.json();

if (!response.ok) {
  const reason = payload.error?.message ?? `HTTP ${response.status}`;
  throw new Error(`Could not read the portfolio sheet: ${reason}`);
}

const [headers = [], ...rows] = payload.values ?? [];
const headerIndexes = new Map(
  headers.map((header, index) => [String(header).trim().toLowerCase(), index]),
);
const requiredHeaders = ['name', 'url', 'order', 'visible'];
const missingHeaders = requiredHeaders.filter((header) => !headerIndexes.has(header));

if (missingHeaders.length > 0) {
  throw new Error(`The sheet is missing required columns: ${missingHeaders.join(', ')}`);
}

const projects = rows
  .map((row, sourceIndex) => ({
    name: String(row[headerIndexes.get('name')] ?? '').trim(),
    url: String(row[headerIndexes.get('url')] ?? '').trim(),
    order: Number(row[headerIndexes.get('order')]),
    visible: ['true', '1', 'yes'].includes(
      String(row[headerIndexes.get('visible')] ?? '').trim().toLowerCase(),
    ),
    sourceIndex,
  }))
  .filter((project) => project.name || project.url || project.visible)
  .filter((project) => project.visible)
  .sort((left, right) => left.order - right.order || left.sourceIndex - right.sourceIndex);

if (projects.length === 0) {
  throw new Error('The sheet has no visible projects; the existing portfolio was left unchanged.');
}

for (const project of projects) {
  if (!project.name) {
    throw new Error('Every visible project must have a name.');
  }

  if (!Number.isFinite(project.order)) {
    throw new Error(`Project "${project.name}" must have a numeric Order value.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(project.url);
  } catch {
    throw new Error(`Project "${project.name}" has an invalid URL.`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Project "${project.name}" URL must use HTTPS.`);
  }
}

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

const renderedProjects = projects
  .map(
    ({ name, url }) =>
      `              <p><a class="text-white opacity-75 hover--opacity-1 underline-0" target="_blank" rel="noopener noreferrer" href="${escapeHtml(url)}">${escapeHtml(name)}</a></p>`,
  )
  .join('\n');

const html = await readFile(portfolioPath, 'utf8');
const startIndex = html.indexOf(startMarker);
const endIndex = html.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error('Portfolio project markers were not found; no files were changed.');
}

const contentStart = startIndex + startMarker.length;
const updatedHtml = `${html.slice(0, contentStart)}\n${renderedProjects}\n              ${html.slice(endIndex)}`;

if (updatedHtml !== html) {
  await writeFile(portfolioPath, updatedHtml);
  console.log(`Updated portfolio.html with ${projects.length} visible projects.`);
} else {
  console.log(`Portfolio is already current (${projects.length} visible projects).`);
}
