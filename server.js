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

const {
  parseNutrition, parseIngredients, detectAllergens,
  calculateDailyValuePercent, calculateHealthScore,
} = require('./nutritionParser');
const { getLLMAnalysis, ruleBasedFallback } = require('./llmNutritionist');
const { readBarcode } = require('./barcodeReader');
const { lookupProduct } = require('./openFoodFacts');
const { connectDB, isDbConnected } = require('./db');
const ScanHistory = require('./models/ScanHistory');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

const TESSERACT_CONFIG = { lang: 'eng', oem: 1, psm: 3 };

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Food Label Reader backend is running' });
});

app.get('/api/history', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected. Set MONGODB_URI in .env to enable history.' });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const scans = await ScanHistory.find().sort({ createdAt: -1 }).limit(limit);
    res.json({ count: scans.length, scans });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch history: ${err.message}` });
  }
});

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Send a file under field name "image".' });
  }

  const filePath = req.file.path;

  // Health conditions selected on the frontend, sent as a JSON string
  // field alongside the image (e.g. '["diabetes","high_bp"]').
  let conditions = [];
  try {
    conditions = req.body.conditions ? JSON.parse(req.body.conditions) : [];
  } catch {
    conditions = [];
  }

  try {
    // 1. OCR
    const extractedText = await tesseract.recognize(filePath, TESSERACT_CONFIG);

    // 2. Parse nutrition + ingredients
    const nutrition = parseNutrition(extractedText);
    const ingredients = /ingredient/i.test(extractedText) ? parseIngredients(extractedText) : [];
    const allergens = detectAllergens(ingredients);
    const dvPercent = calculateDailyValuePercent(nutrition);
    const healthScore = calculateHealthScore(dvPercent, nutrition);

    // 2b. Barcode/QR scan + OpenFoodFacts lookup (Nutri-Score / NOVA / Eco-Score).
    // Only runs if a product code is actually visible in the photo —
    // most nutrition-facts-panel photos won't have one in frame.
    const scanned = readBarcode(filePath);
    let openFoodFacts;
    if (scanned && scanned.isProductCode) {
      openFoodFacts = await lookupProduct(scanned.code);
    } else if (scanned) {
      // A QR code was found, but it doesn't encode a recognizable product
      // code (e.g. a promo/website link) — nothing to look up.
      openFoodFacts = { found: false, reason: 'QR code detected, but it is not a product code' };
    } else {
      openFoodFacts = { found: false, reason: 'No barcode or QR code detected in image' };
    }

    // 3. LLM-based qualitative analysis (falls back to rule-based if no HF_TOKEN)
    let healthAnalysis;
    const llmResult = await getLLMAnalysis(nutrition, dvPercent, ingredients, conditions);
    if (llmResult.analysis) {
      healthAnalysis = llmResult.analysis;
    } else {
      healthAnalysis = ruleBasedFallback(dvPercent, conditions) + (llmResult.error ? ` (LLM unavailable: ${llmResult.error})` : '');
    }

    const responsePayload = {
      extractedText,
      nutrition,
      dailyValuePercent: dvPercent,
      ingredients,
      allergens,
      healthScore,
      healthAnalysis,
      conditions,
      barcode: scanned ? scanned.code : null,
      barcodeType: scanned ? scanned.symbolType : null,
      openFoodFacts,
    };

    res.json(responsePayload);

    // 4. Save to history — best-effort, fire-and-forget. Runs *after*
    // res.json() so a slow/failed DB write never delays the user's
    // response, and a DB outage never breaks scanning.
    if (isDbConnected()) {
      ScanHistory.create(responsePayload).catch((err) => {
        console.error('Failed to save scan to history:', err.message);
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Processing failed: ${err.message}` });
  } finally {
    fs.unlink(filePath, () => {}); // clean up uploaded temp file
  }
});

connectDB().finally(() => {
  app.listen(PORT, () => {
    console.log(`Food Label Reader backend listening on http://localhost:${PORT}`);
  });
});

module.exports = app;
