/**
 * columnDetector.js
 *
 * REAL, PREVIOUSLY-UNRESOLVED LIMITATION: dual-column labels ("Per Serving |
 * Per Container" values printed side by side) fail on almost every field,
 * because reading the image as one block of text interleaves the two
 * columns line-by-line into garbage that no regex can reliably parse.
 * node-tesseract-ocr (used elsewhere in this backend) only returns plain
 * text, so this calls the `tesseract` binary directly in TSV mode to get
 * word-level bounding boxes, detects a genuine vertical gap splitting the
 * words into two columns, and reconstructs each column as its own
 * line-ordered text block — mirroring the fix already verified in
 * src/nutrition_parser.py (see that file's docstring for the same logic
 * in Python, tested against a synthetic two-column label).
 */

const { execFile } = require('child_process');

function runTesseractTsv(imagePath) {
  return new Promise((resolve, reject) => {
    // -c tessedit_create_tsv=1 with stdout output gives per-word bounding
    // boxes (left, top, width, height, conf, text) — the same data
    // pytesseract.image_to_data exposes on the Python side.
    execFile('tesseract', [imagePath, 'stdout', '--psm', '3', '-c', 'tessedit_create_tsv=1'], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

function parseTsv(tsv) {
  const lines = tsv.split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  const idx = (name) => header.indexOf(name);
  const words = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const text = (cols[idx('text')] || '').trim();
    const conf = parseFloat(cols[idx('conf')]);
    if (!text || Number.isNaN(conf) || conf < 0) continue;
    words.push({
      text,
      left: parseInt(cols[idx('left')], 10),
      top: parseInt(cols[idx('top')], 10),
      width: parseInt(cols[idx('width')], 10),
      height: parseInt(cols[idx('height')], 10),
    });
  }
  return words;
}

function wordsToText(wordList) {
  const sorted = [...wordList].sort((a, b) => a.top - b.top);
  const rows = [];
  for (const w of sorted) {
    let placed = false;
    for (const row of rows) {
      if (Math.abs(row[0].top - w.top) < Math.max(row[0].height, w.height) * 0.6) {
        row.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([w]);
  }
  rows.sort((a, b) => {
    const avg = (r) => r.reduce((s, w) => s + w.top, 0) / r.length;
    return avg(a) - avg(b);
  });
  return rows
    .map((row) => row.slice().sort((a, b) => a.left - b.left).map((w) => w.text).join(' '))
    .join('\n');
}

// Reconstructs [leftColumnText, rightColumnText] if a confident two-column
// split exists, else returns null (caller should keep using the normal
// single-block OCR text).
function reconstructColumns(words, imageWidth, minGapFraction = 0.12) {
  if (words.length < 6) return null;

  const centers = words.map((w) => w.left + w.width / 2).sort((a, b) => a - b);
  let biggestGap = -1;
  let gapStart = 0;
  let gapEnd = 0;
  for (let i = 0; i < centers.length - 1; i++) {
    const gap = centers[i + 1] - centers[i];
    if (gap > biggestGap) {
      biggestGap = gap;
      gapStart = centers[i];
      gapEnd = centers[i + 1];
    }
  }

  if (biggestGap < imageWidth * minGapFraction) return null;

  const splitX = (gapStart + gapEnd) / 2;
  const leftWords = words.filter((w) => w.left + w.width / 2 < splitX);
  const rightWords = words.filter((w) => w.left + w.width / 2 >= splitX);

  if (leftWords.length < 4 || rightWords.length < 4) return null;

  return [wordsToText(leftWords), wordsToText(rightWords)];
}

// Returns [leftColumnText, rightColumnText] or null. imageWidth must be
// passed in (e.g. from sharp's metadata) since TSV output doesn't include it.
async function extractColumnsIfPresent(imagePath, imageWidth) {
  try {
    const tsv = await runTesseractTsv(imagePath);
    const words = parseTsv(tsv);
    return reconstructColumns(words, imageWidth);
  } catch (err) {
    // Column detection is a best-effort enhancement, not a required step —
    // if the tesseract TSV call fails for any reason, fall back silently
    // to the normal (already-working) OCR path rather than failing the
    // whole request.
    console.warn('[columnDetector] TSV column detection failed, falling back:', err.message);
    return null;
  }
}

module.exports = { extractColumnsIfPresent };
