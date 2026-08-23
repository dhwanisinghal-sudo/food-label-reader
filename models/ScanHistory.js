/**
 * ScanHistory.js
 * Mongoose model for a saved food label scan — mirrors the shape of the
 * /api/analyze response so past scans can be reviewed later.
 */

const mongoose = require('mongoose');

const scanHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  extractedText: { type: String, default: '' },
  nutrition: { type: mongoose.Schema.Types.Mixed, default: {} },
  dailyValuePercent: { type: mongoose.Schema.Types.Mixed, default: {} },
  ingredients: { type: [String], default: [] },
  ingredientsSource: { type: String, default: null },
  allergens: { type: mongoose.Schema.Types.Mixed, default: {} },
  additives: { type: mongoose.Schema.Types.Mixed, default: {} },
  dietCompatibility: { type: mongoose.Schema.Types.Mixed, default: null },
  healthScore: { type: mongoose.Schema.Types.Mixed, default: {} },
  healthAnalysis: { type: String, default: '' },
  conditions: { type: [String], default: [] },
  barcode: { type: String, default: null },
  barcodeType: { type: String, default: null },
  openFoodFacts: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ScanHistory', scanHistorySchema);
