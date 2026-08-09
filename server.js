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

    // 3. LLM-based qualitative analysis (falls back to rule-based if no HF_TOKEN)
    let healthAnalysis;
    const llmResult = await getLLMAnalysis(nutrition, dvPercent, ingredients, conditions);
    if (llmResult.analysis) {
      healthAnalysis = llmResult.analysis;
    } else {
      healthAnalysis = ruleBasedFallback(dvPercent, conditions) + (llmResult.error ? ` (LLM unavailable: ${llmResult.error})` : '');
    }

    res.json({
      extractedText,
      nutrition,
      dailyValuePercent: dvPercent,
      ingredients,
      allergens,
      healthScore,
      healthAnalysis,
      conditions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Processing failed: ${err.message}` });
  } finally {
    fs.unlink(filePath, () => {}); // clean up uploaded temp file
  }
});

app.listen(PORT, () => {
  console.log(`Food Label Reader backend listening on http://localhost:${PORT}`);
});

module.exports = app;
