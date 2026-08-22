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
  parseNutrition, parseIngredients, detectAllergens, detectAdditives,
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
app.use(express.static(__dirname));

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
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

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

const TESSERACT_CONFIG = { lang: 'eng', oem: 1, psm: 3 };

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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

app.post('/api/analyze', uploadFields, async (req, res) => {
  const mainFile = req.files && req.files.image && req.files.image[0];
  const ingredientsFile = req.files && req.files.ingredientsImage && req.files.ingredientsImage[0];

  if (!mainFile) {
    return res.status(400).json({ error: 'No image uploaded. Send a file under field name "image".' });
  }

  const filePath = mainFile.path;
  const ingredientsFilePath = ingredientsFile ? ingredientsFile.path : null;

  let conditions = [];
  try {
    conditions = req.body.conditions ? JSON.parse(req.body.conditions) : [];
  } catch {
    conditions = [];
  }

  try {
    const extractedText = await tesseract.recognize(filePath, TESSERACT_CONFIG);

    const nutrition = parseNutrition(extractedText);

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
      const ingredientsText = await tesseract.recognize(ingredientsFilePath, TESSERACT_CONFIG);
      const fromSecondPhoto = parseIngredients(ingredientsText);
      if (fromSecondPhoto.length) {
        ingredients = fromSecondPhoto;
        ingredientsSource = 'ingredients_photo';
      }
    }

    const allergens = detectAllergens(ingredients);
    const additives = detectAdditives(ingredients);
    const dvPercent = calculateDailyValuePercent(nutrition);

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

    const healthScore = calculateHealthScore(dvPercent, nutrition, additives, novaGroup);

    let healthAnalysis;
    const llmResult = await getLLMAnalysis(nutrition, dvPercent, ingredients, conditions, additives);
    if (llmResult.analysis) {
      healthAnalysis = llmResult.analysis;
    } else {
      healthAnalysis = ruleBasedFallback(dvPercent, conditions, ingredients, additives) + (llmResult.error ? ` (LLM unavailable: ${llmResult.error})` : '');
    }

    const responsePayload = {
      extractedText,
      nutrition,
      dailyValuePercent: dvPercent,
      ingredients,
      ingredientsSource,
      allergens,
      additives,
      healthScore,
      healthAnalysis,
      conditions,
      barcode: scanned ? scanned.code : null,
      barcodeType: scanned ? scanned.symbolType : null,
      openFoodFacts,
    };

    res.json(responsePayload);

    if (isDbConnected()) {
      ScanHistory.create(responsePayload).catch((err) => {
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

connectDB().finally(() => {
  app.listen(PORT, () => {
    console.log(`Food Label Reader backend listening on http://localhost:${PORT}`);
  });
});

module.exports = app;
