/**
 * exportUtils.js
 *
 * Mirrors the web app's export feature (index.html's exportJsonBtn /
 * exportPdfBtn handlers) for the mobile app, which had no export at all
 * before this. Two differences from the web version, both inherent to
 * mobile rather than choices:
 *  - There's no browser download; files are written to the app's private
 *    cache directory, then handed to the OS share sheet (expo-sharing) so
 *    the user picks where to save/send them (Files app, email, etc).
 *  - PDF generation uses expo-print's HTML-to-PDF renderer instead of
 *    jsPDF (which is browser-only) -- the HTML template below is written
 *    to mirror the web app's PDF layout/section order, not copy its code.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';

// halalKosher has a different (two-tier) shape from the other diets' plain
// `conflicts` array -- see checkHalalKosher's docstring in the backend's
// nutritionParser.js for why. Matches the same helper added to the web
// app's index.html, so both clients describe an identical conflict the
// same way.
function conflictsListFor(key, entry) {
  if (key === 'halalKosher') {
    const list = [...(entry.definiteConflicts || [])];
    (entry.uncertainIngredients || []).forEach((i) => list.push(`${i} (needs verification)`));
    return list;
  }
  return entry.conflicts || [];
}

const DIET_LABELS = {
  vegan: 'Vegan', vegetarian: 'Vegetarian', halalKosher: 'Halal/Kosher',
  keto: 'Keto', paleo: 'Paleo', lowFodmap: 'Low-FODMAP',
};

function fileBaseName(result) {
  const name = result?.openFoodFacts?.productName;
  const safe = (name || 'food-label-scan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${safe || 'food-label-scan'}-${Date.now()}`;
}

async function shareFile(uri) {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri);
}

export async function exportResultAsJson(result) {
  const base = fileBaseName(result);
  const file = new File(Paths.cache, `${base}.json`);
  await file.write(JSON.stringify(result, null, 2));
  await shareFile(file.uri);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReportHtml(result) {
  const {
    nutrition = {}, ingredients = [], allergens = {}, dietCompatibility,
    healthScore, healthAnalysis, openFoodFacts, createdAt,
  } = result || {};

  const scoreValue = healthScore?.score;
  const scoreLabel = healthScore?.label;

  const nutritionRows = Object.entries(nutrition)
    .filter(([key]) => key !== 'serving_size' && key !== 'serving_size_parsed')
    .map(([key, val]) => `<tr><td>${escapeHtml(key.replace(/_/g, ' '))}</td><td>${escapeHtml(typeof val === 'object' ? JSON.stringify(val) : val)}</td></tr>`)
    .join('');

  const allergenKeys = Object.keys(allergens || {});
  const allergenSection = allergenKeys.length
    ? `<h2>Allergen Alerts</h2><ul>${allergenKeys.map((k) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml((allergens[k] || []).join(', '))}</li>`).join('')}</ul>`
    : '';

  const dietSection = dietCompatibility
    ? `<h2>Diet Compatibility</h2><ul>${Object.entries(DIET_LABELS).map(([key, label]) => {
      const entry = dietCompatibility[key];
      if (!entry) return '';
      const status = entry.friendly ? 'Compatible' : `Conflicts — ${escapeHtml(conflictsListFor(key, entry).join(', '))}`;
      return `<li><strong>${label}:</strong> ${status}</li>`;
    }).join('')}</ul>`
    : '';

  const ingredientsSection = ingredients.length
    ? `<h2>Ingredients</h2><p>${escapeHtml(ingredients.join(', '))}</p>`
    : '';

  const productLine = openFoodFacts?.found && openFoodFacts?.productName
    ? `<h1>${escapeHtml(openFoodFacts.productName)}</h1>`
    : '<h1>Food Label Reader — Scan Report</h1>';

  const analysisSection = healthAnalysis
    ? `<h2>Nutritionist's Note</h2><p>${escapeHtml(typeof healthAnalysis === 'string' ? healthAnalysis : JSON.stringify(healthAnalysis))}</p>`
    : '';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Helvetica, Arial, sans-serif; padding: 24px; color: #222; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { font-size: 15px; margin-top: 20px; margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          .meta { color: #777; font-size: 12px; margin-bottom: 14px; }
          .score { font-size: 28px; font-weight: 700; margin: 10px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          td { padding: 4px 0; border-bottom: 1px solid #eee; text-transform: capitalize; }
          td:last-child { text-align: right; font-weight: 600; text-transform: none; }
          ul { padding-left: 18px; font-size: 13px; }
        </style>
      </head>
      <body>
        ${productLine}
        <div class="meta">Scanned: ${escapeHtml(new Date(createdAt || Date.now()).toLocaleString())}</div>
        ${scoreValue != null ? `<div class="score">Health Score: ${scoreValue}/100 (${escapeHtml(scoreLabel || '')})</div>` : ''}
        <h2>Nutrition (per serving)</h2>
        <table>${nutritionRows}</table>
        ${allergenSection}
        ${dietSection}
        ${ingredientsSection}
        ${analysisSection}
      </body>
    </html>
  `;
}

export async function exportResultAsPdf(result) {
  const html = buildReportHtml(result);
  const { uri } = await Print.printToFileAsync({ html });
  // printToFileAsync writes to a random cache filename; rename to
  // something the user will recognize in a share sheet / Files app.
  const base = fileBaseName(result);
  const sourceFile = new File(uri);
  const renamedFile = new File(Paths.cache, `${base}.pdf`);
  sourceFile.move(renamedFile);
  await shareFile(renamedFile.uri);
}
