/**
 * nutritionParser.js
 * Ported from the Python notebook logic — same OCR-misread fixes:
 *  - digit/letter confusion (0<->O, l<->1)
 *  - unit char fused into the number (e.g. "36g" OCR'd as "369")
 *  - %DV cross-check to self-correct garbled amounts
 */

const DAILY_VALUES = {
  calories: 2000, total_fat_g: 78, saturated_fat_g: 20,
  cholesterol_mg: 300, sodium_mg: 2300, total_carbs_g: 275,
  fiber_g: 28, total_sugars_g: 50, added_sugars_g: 50, protein_g: 50,
};

const PLAUSIBLE_RANGE = {
  calories: [0, 2000], total_fat_g: [0, 100], saturated_fat_g: [0, 60],
  trans_fat_g: [0, 20], cholesterol_mg: [0, 500], sodium_mg: [0, 5000],
  total_carbs_g: [0, 150], fiber_g: [0, 60], total_sugars_g: [0, 150],
  added_sugars_g: [0, 150], protein_g: [0, 100],
};

const NUM = '([0-9OoIl]+\\.?[0-9]*)';

const PATTERNS = {
  calories: new RegExp('calories\\s*' + NUM, 'i'),
  total_fat_g: new RegExp('total fat\\s*' + NUM + '\\s*[g)]', 'i'),
  saturated_fat_g: new RegExp('saturated fat\\s*' + NUM + '\\s*[g)]', 'i'),
  trans_fat_g: new RegExp('trans fat\\s*' + NUM + '\\s*[g)]', 'i'),
  cholesterol_mg: new RegExp('cholesterol\\s*' + NUM + '\\s*m[ga]', 'i'),
  sodium_mg: new RegExp('sodium\\s*' + NUM + '\\s*m[ga]', 'i'),
  total_carbs_g: new RegExp('total carboh[yi]d[nr]ate\\s*' + NUM + '\\s*[g)]', 'i'),
  fiber_g: new RegExp('(?:dietary\\s*)?fiber\\s*(?:less than\\s*)?' + NUM + '\\s*[g)]?', 'i'),
  total_sugars_g: new RegExp('(?:total\\s+)?sugars\\s*' + NUM + '\\s*[g)]', 'i'),
  added_sugars_g: new RegExp('includes\\s*' + NUM + '\\s*[g)]\\s*added sugars', 'i'),
  protein_g: new RegExp('protein\\s*' + NUM + '\\s*[g3]', 'i'),
};

function cleanNum(raw) {
  const fixed = raw.replace(/O/g, '0').replace(/o/g, '0').replace(/I/g, '1').replace(/l/g, '1');
  const value = parseFloat(fixed);
  return Number.isNaN(value) ? null : value;
}

function parseNutrition(text) {
  const data = {};

  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const match = text.match(pattern);
    if (!match) continue;

    let value = cleanNum(match[1]);
    if (value === null) continue;

    const [lo, hi] = PLAUSIBLE_RANGE[key] || [0, Infinity];
    if (value < lo || value > hi) continue;

    if (key in DAILY_VALUES) {
      const window = text.slice(match.index + match[0].length, match.index + match[0].length + 15);
      const pctMatch = window.match(/(\d{1,3})\s*%/);
      if (pctMatch) {
        const declaredPct = parseFloat(pctMatch[1]);
        const ourPct = (value / DAILY_VALUES[key]) * 100;
        if (declaredPct > 0 && ourPct > 0) {
          const ratio = ourPct / declaredPct;
          if (ratio > 2.5 || ratio < 0.4) {
            value = Math.round((declaredPct / 100) * DAILY_VALUES[key] * 100) / 100;
          }
        }
      }
    }

    data[key] = key === 'calories' ? Math.round(value) : value;
  }

  const servingMatch = text.match(/serving size\s*([^\n]+)/i);
  if (servingMatch) data.serving_size = servingMatch[1].trim();

  return data;
}

function parseIngredients(text) {
  const startMatch = text.match(/ingredients\s*:?/i);
  if (!startMatch) return [];

  // Only look at text AFTER the "Ingredients:" label — text before it
  // (e.g. "Serving Size", "Nutrition Facts") must never be scanned for
  // stop patterns, or it truncates the list before it even starts.
  let cleaned = text.slice(startMatch.index + startMatch[0].length).trim();

  const stopPatterns = [
    /nutrition facts/i, /serving size/i,
    /contains\s+(milk|soy|wheat|egg|nuts?|tree nuts?)/i,
    /percent daily values/i, /calories from fat/i, /%\s*daily value/i,
  ];
  let cutIdx = cleaned.length;
  for (const pat of stopPatterns) {
    const m = cleaned.match(pat);
    if (m && m.index < cutIdx) cutIdx = m.index;
  }
  cleaned = cleaned.slice(0, cutIdx).trim();
  cleaned = cleaned.replace(/\s*\n\s*/g, ' ');

  return cleaned
    .split(',')
    .map((item) => item.trim().replace(/^\.+|\.+$/g, ''))
    .filter((item) => item.length > 0 && item.length <= 60);
}

const ALLERGEN_KEYWORDS = {
  'Milk/Dairy': ['milk', 'dairy', 'lactose', 'casein', 'whey', 'butter', 'cream', 'cheese'],
  Soy: ['soy', 'soya', 'soybean'],
  'Wheat/Gluten': ['wheat', 'gluten', 'barley', 'rye', 'flour'],
  Nuts: ['almond', 'cashew', 'walnut', 'peanut', 'pistachio', 'hazelnut'],
  Egg: ['egg', 'albumin'],
  Sesame: ['sesame', 'tahini'],
};

function detectAllergens(ingredients) {
  const detected = {};
  for (const ingredient of ingredients) {
    const lower = ingredient.toLowerCase();
    for (const [allergen, keywords] of Object.entries(ALLERGEN_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        if (!detected[allergen]) detected[allergen] = [];
        if (!detected[allergen].includes(ingredient)) detected[allergen].push(ingredient);
      }
    }
  }
  return detected;
}

function calculateDailyValuePercent(nutrition) {
  const dv = {};
  for (const [key, amount] of Object.entries(nutrition)) {
    if (key in DAILY_VALUES && amount != null) {
      dv[key] = Math.round((amount / DAILY_VALUES[key]) * 1000) / 10;
    }
  }
  return dv;
}

function calculateHealthScore(dv, nutrition) {
  if (!nutrition || Object.keys(nutrition).length === 0) {
    return { score: null, label: 'N/A (no nutrition data extracted)' };
  }

  let score = 100;

  // Penalize proportionally to the FULL %DV (not just the amount over 20%),
  // so a nutrient that's already at 40-48% DV — nearly half the day's
  // allowance in one serving — meaningfully drags the score down instead
  // of only costing a few points for the excess above 20%.
  const negatives = [
    ['saturated_fat_g', 0.6],
    ['total_sugars_g', 0.5],
    ['sodium_mg', 0.2],
    ['cholesterol_mg', 0.2],
  ];
  for (const [key, weight] of negatives) {
    const pct = dv[key] || 0;
    score -= pct * weight;
  }

  // Small bonus for nutrients that are genuinely beneficial in quantity,
  // so high-fiber/high-protein foods aren't scored the same as empty-calorie ones.
  const positives = [
    ['fiber_g', 20, 5],   // if fiber is >=20% DV, +5
    ['protein_g', 20, 5], // if protein is >=20% DV, +5
  ];
  for (const [key, threshold, bonus] of positives) {
    const pct = dv[key] || 0;
    if (pct >= threshold) score += bonus;
    else if (pct >= threshold / 2) score += bonus / 2;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label;
  if (score >= 80) label = 'Excellent';
  else if (score >= 60) label = 'Good';
  else if (score >= 40) label = 'Moderate';
  else label = 'Poor';
  return { score, label };
}

module.exports = {
  parseNutrition, parseIngredients, detectAllergens,
  calculateDailyValuePercent, calculateHealthScore,
  DAILY_VALUES, cleanNum,
};
