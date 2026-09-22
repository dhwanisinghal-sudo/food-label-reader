/**
 * server.js — Food Label Reader backend
 * Endpoints:
 *   POST /api/analyze  — upload a label photo, get OCR + nutrition + health analysis
 *   GET  /api/health    — health check
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const tesseract = require('node-tesseract-ocr');
const sharp = require('sharp');

// A stray unhandled promise rejection anywhere in the process (not just
// inside /api/analyze) would otherwise terminate the whole Node process on
// Node 15+ — which looks like a random 502 to the client with nothing
// useful in the request-level try/catch. Log and survive instead of dying.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (process kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err);
});

const {
  parseNutrition, parseIngredients, detectAllergens, detectAdditives,
  calculateDailyValuePercent, calculateHealthScore, checkAllDietCompatibility,
  calculateFsaNpmScore, parseServingSizeGrams,
  ADDITIVE_INFO,
} = require('./nutritionParser');
const { getLLMAnalysis, ruleBasedFallback } = require('./llmNutritionist');
const { readBarcode } = require('./barcodeReader');
const { extractColumnsIfPresent } = require('./columnDetector');
const { lookupProduct } = require('./openFoodFacts');
const { connectDB, isDbConnected } = require('./db');
const ScanHistory = require('../models/ScanHistory');
const User = require('../models/User');
const { issueToken, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 5000;

// FIX: server.js lives in src/, but index.html and the uploads/ folder live
// at the repo root. Every path below used to be built from __dirname
// directly, which pointed at src/ once this file moved there during the
// src/ reorganization -- meaning `npm start` couldn't find server.js at all
// (package.json's "start" script and the Dockerfile's CMD both still said
// `node server.js`, not `node src/server.js`), and even once that's fixed,
// this file was still looking for index.html and creating uploads/ inside
// src/ instead of at the project root. ROOT_DIR fixes the paths inside this
// file; package.json and the Dockerfile needed their own separate fix (see
// git history / commit message for this change).
const ROOT_DIR = path.join(__dirname, '..');

app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR));

const upload = multer({
  dest: path.join(ROOT_DIR, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Accepts the main label photo under "image", plus an optional close-up
// photo of just the ingredients list under "ingredientsImage" — useful
// when the ingredients text is physically separate from the nutrition
// facts panel and didn't fit in a single frame.
const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'ingredientsImage', maxCount: 1 },
]);

// GAP FIX: the web app previously only accepted one label photo per
// request (see uploadFields above) — the notebook's "upload several
// photos, get a report for each" workflow had no web equivalent at all.
// This accepts up to 10 independent label photos under the field name
// "images" for a single POST. It does NOT accept a separate
// ingredients-photo per item (that stays single-image-only, under
// /api/analyze) — keeping batch mode to "N full label photos in, N
// reports out" instead of trying to pair up two arrays index-by-index,
// which would be a much easier place to silently mismatch a photo with
// the wrong ingredients shot.
const uploadBatch = upload.array('images', 10);

if (!fs.existsSync(path.join(ROOT_DIR, 'uploads'))) {
  fs.mkdirSync(path.join(ROOT_DIR, 'uploads'));
}

const TESSERACT_CONFIG = { lang: 'eng', oem: 1, psm: 3 };

// Phone-camera label photos routinely come in at 3000-4000px per side and
// several MB — tesseract's memory use scales with pixel count, and on a
// small instance (e.g. Render's free 512MB tier) that's enough to get the
// whole container OOM-killed mid-request, which surfaces to the client as
// a bare 502 with no application-level error to catch. Downscaling to a
// resolution that's still plenty sharp for label text (long edge capped at
// 2000px) cuts memory/CPU use substantially without hurting OCR accuracy.
async function preprocessForOcr(filePath) {
  const outPath = `${filePath}-ocr.jpg`;
  await sharp(filePath)
    .rotate() // apply EXIF orientation so sideways/upside-down photos read correctly
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toFile(outPath);
  return outPath;
}

app.get('/', (req, res) => {
  const indexPath = path.join(ROOT_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error(`index.html not found at ${indexPath} — check for a Docker volume mount masking ${ROOT_DIR}, or that the image was built from the repo root with index.html present.`);
    return res.status(500).send(
      'Server misconfiguration: index.html is missing from the deployed image. '
      + 'This usually means a Docker volume is masking the app directory, or the '
      + 'image was built from a stale/wrong commit. Check server logs for details.',
    );
  }
  res.sendFile(indexPath);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Food Label Reader backend is running' });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/signup', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected. Set MONGODB_URI in .env to enable accounts.' });
  }
  const { email, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.' });
    }

    const user = new User({ email });
    await user.setPassword(password);
    await user.save();

    const token = issueToken(user);
    res.status(201).json({ token, user: { email: user.email } });
  } catch (err) {
    res.status(500).json({ error: `Signup failed: ${err.message}` });
  }
});

app.post('/api/login', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected. Set MONGODB_URI in .env to enable accounts.' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    // Same generic error whether the email doesn't exist or the password is
    // wrong — distinguishing the two lets an attacker enumerate registered
    // emails.
    const invalidCreds = () => res.status(401).json({ error: 'Invalid email or password.' });

    if (!user) return invalidCreds();
    const valid = await user.comparePassword(password);
    if (!valid) return invalidCreds();

    const token = issueToken(user);
    res.json({ token, user: { email: user.email } });
  } catch (err) {
    res.status(500).json({ error: `Login failed: ${err.message}` });
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected. Set MONGODB_URI in .env to enable history.' });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    // Scoped to the logged-in user only — this is what keeps one account's
    // scans from showing up in another account's history.
    const scans = await ScanHistory.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(limit);
    res.json({ count: scans.length, scans });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch history: ${err.message}` });
  }
});

// Runs the full pipeline (OCR -> parse -> allergens/diet/health score ->
// barcode/OpenFoodFacts -> LLM analysis) for ONE already-uploaded image and
// returns the same response shape /api/analyze always returned. Pulled out
// of the /api/analyze route handler so /api/analyze-batch can call it once
// per photo without duplicating ~150 lines of logic that then drift apart —
// see GAP FIX note above uploadBatch. Cleans up its OWN temp files
// (ocrFilePath / ingredientsOcrFilePath) but NOT the original uploaded
// file(s) at filePath/ingredientsFilePath — the caller owns those, since
// batch mode needs to keep multer's per-file bookkeeping in the caller.
async function analyzeOneImage(filePath, { ingredientsFilePath = null, conditions = [], ageGroup = 'adults_children_4plus' } = {}) {
  let ocrFilePath = null;
  let ingredientsOcrFilePath = null;
  try {
    ocrFilePath = await preprocessForOcr(filePath);
    const extractedText = await tesseract.recognize(ocrFilePath, TESSERACT_CONFIG);

    let nutrition = parseNutrition(extractedText);

    // Two-column label fix ("Per Serving | Per Container" values printed
    // side by side, e.g. jenis_ice_cream_double_dough / savoritz_parmesan_crisps
    // in tests/real_ground_truth.csv) — these used to fail on almost every
    // field because reading the label as one text block interleaves the
    // two columns. If a genuine two-column split is detected AND parsing
    // one column alone recovers MORE fields than the whole-image parse
    // above, use that column's result instead. See src/columnDetector.js
    // and src/nutrition_parser.py's matching Python implementation.
    let columnsDetected = false;
    try {
      const { width: imageWidth } = await sharp(ocrFilePath).metadata();
      const columns = await extractColumnsIfPresent(ocrFilePath, imageWidth);
      if (columns) {
        const colParses = columns.map((colText) => parseNutrition(colText));
        const bestColIdx = colParses[0] && Object.keys(colParses[0]).length >= Object.keys(colParses[1] || {}).length ? 0 : 1;
        const bestColParse = colParses[bestColIdx];
        if (Object.keys(bestColParse).length > Object.keys(nutrition).length) {
          nutrition = bestColParse;
          columnsDetected = true;
        }
      }
    } catch (err) {
      console.warn('[server] column detection failed, using whole-image parse:', err.message);
    }

    // parseNutrition tracks every OCR-digit-fix, %DV cross-check, and
    // fuzzy/positional guess it made internally so the values it returns
    // are as accurate as possible. That detail is for us to debug/audit
    // with, not for the end user to see — log it server-side and strip it
    // out before anything goes back to the client.
    const nutritionCorrections = nutrition.corrections || null;
    if (nutritionCorrections) {
      console.log(`[nutrition parser] ${nutritionCorrections.length} internal correction(s) applied:`,
        JSON.stringify(nutritionCorrections));
      delete nutrition.corrections;
    }

    let ingredients = parseIngredients(extractedText);
    let ingredientsSource = ingredients.length ? 'main_photo' : null;

    // Fallback: the ingredients heading often isn't in the same frame as the
    // nutrition facts panel. If the main photo didn't yield anything and a
    // dedicated ingredients photo was provided, OCR that separately and
    // parse ingredients from it instead.
    if (ingredients.length === 0 && ingredientsFilePath) {
      ingredientsOcrFilePath = await preprocessForOcr(ingredientsFilePath);
      const ingredientsText = await tesseract.recognize(ingredientsOcrFilePath, TESSERACT_CONFIG);
      const fromSecondPhoto = parseIngredients(ingredientsText);
      if (fromSecondPhoto.length) {
        ingredients = fromSecondPhoto;
        ingredientsSource = 'ingredients_photo';
      }
    }

    const allergens = detectAllergens(ingredients);
    const additives = detectAdditives(ingredients);
    // Map each detected additive category to its plain-language note, so the
    // client can show "why does this matter" instead of just a bare label.
    // Only includes categories actually present — no notes for undetected ones.
    const additiveInfo = {};
    for (const category of Object.keys(additives)) {
      if (additives[category] && additives[category].length && ADDITIVE_INFO[category]) {
        additiveInfo[category] = ADDITIVE_INFO[category];
      }
    }
    const dvPercent = calculateDailyValuePercent(nutrition, ageGroup);
    // null (not an empty per-diet object) when no ingredients were parsed —
    // the frontend treats null as "can't tell, no ingredients list found"
    // rather than showing every diet tag as falsely compatible.
    const dietCompatibility = checkAllDietCompatibility(nutrition, ingredients);

    // Barcode/OpenFoodFacts lookup runs BEFORE scoring now (it used to run
    // after), so the NOVA processing group — when available — can feed into
    // the same score the additive/macro penalties feed into, instead of
    // sitting unused in the response.
    const scanned = readBarcode(filePath);
    let openFoodFacts;
    if (scanned && scanned.isProductCode) {
      openFoodFacts = await lookupProduct(scanned.code);
    } else if (scanned) {
      openFoodFacts = { found: false, reason: 'QR code detected, but it is not a product code' };
    } else {
      openFoodFacts = { found: false, reason: 'No barcode or QR code detected in image' };
    }
    const novaGroup = (openFoodFacts && openFoodFacts.found) ? openFoodFacts.novaGroup : null;
    const nutriscoreGrade = (openFoodFacts && openFoodFacts.found) ? openFoodFacts.nutriScore : null;

    const healthScore = calculateHealthScore(dvPercent, nutrition, additives, novaGroup, nutriscoreGrade);

    // FSA/Ofcom Nutrient Profiling Model score, alongside the custom
    // heuristic above -- see calculateFsaNpmScore's comment in
    // nutritionParser.js for why both are offered rather than just one.
    const servingSizeGrams = parseServingSizeGrams(extractedText);
    const fsaNpmScore = calculateFsaNpmScore(nutrition, servingSizeGrams);

    let healthAnalysis;
    const llmResult = await getLLMAnalysis(nutrition, dvPercent, ingredients, conditions, additives);
    if (llmResult.analysis) {
      healthAnalysis = llmResult.analysis;
    } else {
      // llmResult.error is an internal/debug message (e.g. "LLM output named
      // an additive not matching the parsed ingredients — discarded"). It's
      // useful in server logs but meaningless and alarming to an end user
      // ("LLM unavailable: ..."), so it's logged here and never appended to
      // the user-facing analysis text. The rule-based fallback is already
      // accurate on its own and needs no caveat.
      if (llmResult.error) {
        console.warn('LLM analysis unavailable, using rule-based fallback:', llmResult.error);
      }
      healthAnalysis = ruleBasedFallback(dvPercent, conditions, ingredients, additives);
    }

    return {
      extractedText,
      nutrition,
      dailyValuePercent: dvPercent,
      ingredients,
      ingredientsSource,
      allergens,
      additives,
      additiveInfo,
      dietCompatibility,
      healthScore,
      healthAnalysis,
      conditions,
      ageGroup,
      barcode: scanned ? scanned.code : null,
      barcodeType: scanned ? scanned.symbolType : null,
      openFoodFacts,
      columnsDetected,
      fsaNpmScore,
    };
  } finally {
    // Only the temp files THIS function created (the preprocessed
    // OCR-ready copies) are cleaned up here. The original upload(s) at
    // filePath/ingredientsFilePath are the caller's responsibility, since
    // batch mode holds onto them slightly differently (see route handlers).
    if (ocrFilePath) fs.unlink(ocrFilePath, () => {});
    if (ingredientsOcrFilePath) fs.unlink(ingredientsOcrFilePath, () => {});
  }
}

function parseConditions(rawConditions) {
  try {
    return rawConditions ? JSON.parse(rawConditions) : [];
  } catch {
    return [];
  }
}

function resolveAgeGroup(rawAgeGroup) {
  return ['adults_children_4plus', 'children_1_3', 'pregnant_lactating']
    .includes(rawAgeGroup) ? rawAgeGroup : 'adults_children_4plus';
}

app.post('/api/analyze', requireAuth, uploadFields, async (req, res) => {
  const mainFile = req.files && req.files.image && req.files.image[0];
  const ingredientsFile = req.files && req.files.ingredientsImage && req.files.ingredientsImage[0];

  if (!mainFile) {
    return res.status(400).json({ error: 'No image uploaded. Send a file under field name "image".' });
  }

  const filePath = mainFile.path;
  const ingredientsFilePath = ingredientsFile ? ingredientsFile.path : null;
  const conditions = parseConditions(req.body.conditions);
  const ageGroup = resolveAgeGroup(req.body.ageGroup);

  try {
    const responsePayload = await analyzeOneImage(filePath, { ingredientsFilePath, conditions, ageGroup });
    res.json(responsePayload);

    if (isDbConnected()) {
      ScanHistory.create({ ...responsePayload, userId: req.userId }).catch((err) => {
        console.error('Failed to save scan to history:', err.message);
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Processing failed: ${err.message}` });
  } finally {
    fs.unlink(filePath, () => {});
    if (ingredientsFilePath) fs.unlink(ingredientsFilePath, () => {});
  }
});

// GAP FIX: multi-image batch endpoint (see uploadBatch above). Each photo
// is fully independent — one photo failing (bad OCR, corrupt file, etc.)
// is reported as an error entry for that photo only and does not abort the
// rest of the batch, mirroring the notebook's "each image gets its own
// report" behavior instead of an all-or-nothing request.
app.post('/api/analyze-batch', requireAuth, uploadBatch, async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No images uploaded. Send one or more files under field name "images".' });
  }

  const conditions = parseConditions(req.body.conditions);
  const ageGroup = resolveAgeGroup(req.body.ageGroup);

  const results = [];
  for (const file of files) {
    try {
      const responsePayload = await analyzeOneImage(file.path, { conditions, ageGroup });
      results.push({ filename: file.originalname, success: true, ...responsePayload });

      if (isDbConnected()) {
        ScanHistory.create({ ...responsePayload, userId: req.userId }).catch((err) => {
          console.error('Failed to save scan to history:', err.message);
        });
      }
    } catch (err) {
      console.error(`[batch] failed on ${file.originalname}:`, err);
      results.push({ filename: file.originalname, success: false, error: `Processing failed: ${err.message}` });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }

  res.json({ count: results.length, results });
});

connectDB().finally(() => {
  app.listen(PORT, () => {
    console.log(`Food Label Reader backend listening on http://localhost:${PORT}`);
  });
});

module.exports = app;
