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

// Tolerant to common OCR misreads: INGREDIENTS -> INGREDlENTS, INGREDIENT5,
// NGREDIENTS (dropped leading I), etc. Matches the label heading and
// everything up to the first stop pattern below.
const INGREDIENTS_HEADING = /i?ngr[e3]d[il1]?[e3]nts?\s*:?/i;

function parseIngredients(text) {
  const headingMatch = text.match(INGREDIENTS_HEADING);
  // If we can't even find the heading, there's nothing reliable to slice —
  // return [] rather than guessing from the whole OCR text.
  if (!headingMatch) return [];

  let cleaned = text.slice(headingMatch.index + headingMatch[0].length).trim();

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

// Additive categories that the health SCORE needs to know about, so the
// numeric score and the ingredient-based nutritionist note can never
// contradict each other the way "98 Excellent" + "artificial colors" did.
// Keywords are lowercase; matched against the full lowercased ingredient string.
const ADDITIVE_KEYWORDS = {
  artificialColors: [
    'red 40', 'red no. 40', 'red 3', 'red no. 3', 'yellow 5', 'yellow no. 5',
    'yellow 6', 'yellow no. 6', 'blue 1', 'blue no. 1', 'blue 2', 'blue no. 2',
    'green 3', 'fd&c', 'fd & c', 'artificial color', 'artificial colour', 'caramel color',
  ],
  artificialSweeteners: [
    'aspartame', 'sucralose', 'acesulfame', 'saccharin', 'neotame', 'advantame',
  ],
  nitritesNitrates: [
    'sodium nitrite', 'sodium nitrate', 'potassium nitrite', 'potassium nitrate',
  ],
  otherPreservatives: [
    'bht', 'bha', 'tbhq', 'sodium benzoate', 'potassium sorbate',
    'sodium metabisulfite', 'sulfur dioxide', 'propyl gallate',
  ],
  hydrogenatedOils: [
    'partially hydrogenated', 'hydrogenated oil', 'hydrogenated vegetable oil',
  ],
  flavorEnhancers: [
    'monosodium glutamate', 'msg', 'disodium inosinate', 'disodium guanylate',
  ],
};

// --- OCR-tolerant fuzzy matching -----------------------------------------
// OCR on a real label photo routinely mangles ingredient text — "aspartame"
// becomes "asparfame", "Red 40" becomes "Red4O", "sucralose" becomes
// "sucraiose". Plain substring matching misses all of these. We normalize
// obvious digit/letter confusions first, then fall back to edit-distance
// matching so small OCR typos still get caught.

// Digit/letter confusions, applied only in contexts where they plausibly
// matter (touching a digit) so ordinary words aren't corrupted.
function normalizeOcrText(text) {
  return text
    .replace(/[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[oO]/g, '0')
    .replace(/[lI](?=\d)/g, '1')
    .replace(/(?<=\d)[lI]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

// Slides a word-window across `text` and checks edit distance against
// `keyword`, so OCR typos are caught without an exact match. Keywords
// under 4 chars (e.g. "msg", "bht") skip fuzzy matching entirely — at
// that length, fuzzy matching causes more false positives than it fixes.
function fuzzyIncludes(text, keyword) {
  if (text.includes(keyword)) return true;
  const kLen = keyword.length;
  if (kLen < 4) return false;
  const maxDist = kLen <= 6 ? 1 : kLen <= 12 ? 2 : 3;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const keywordWordCount = keyword.split(' ').length;
  for (let size = 1; size <= keywordWordCount + 1; size += 1) {
    for (let i = 0; i <= words.length - size; i += 1) {
      const chunk = words.slice(i, i + size).join(' ');
      if (Math.abs(chunk.length - kLen) > maxDist) continue;
      if (levenshtein(chunk, keyword) <= maxDist) return true;
    }
  }
  return false;
}

// --- E-number / INS-number detection --------------------------------------
// Many labels — especially outside the US, including most Indian packaged
// food — list additives by E-number (EU) or INS-number (India; numerically
// identical to E-numbers) instead of a name like "Red 40". Deliberately
// excludes natural colors/additives (E100 curcumin, E140 chlorophyll, E160
// carotenes, etc.) so we don't over-flag safe, naturally-derived ingredients.
const E_NUMBER_MAP = {
  102: { category: 'artificialColors', name: 'Tartrazine (E102 / INS 102, Yellow 5)' },
  104: { category: 'artificialColors', name: 'Quinoline Yellow (E104 / INS 104)' },
  110: { category: 'artificialColors', name: 'Sunset Yellow FCF (E110 / INS 110, Yellow 6)' },
  122: { category: 'artificialColors', name: 'Carmoisine (E122 / INS 122)' },
  123: { category: 'artificialColors', name: 'Amaranth (E123 / INS 123)' },
  124: { category: 'artificialColors', name: 'Ponceau 4R (E124 / INS 124)' },
  127: { category: 'artificialColors', name: 'Erythrosine (E127 / INS 127, Red 3)' },
  129: { category: 'artificialColors', name: 'Allura Red (E129 / INS 129, Red 40)' },
  131: { category: 'artificialColors', name: 'Patent Blue V (E131 / INS 131)' },
  132: { category: 'artificialColors', name: 'Indigo Carmine (E132 / INS 132, Blue 2)' },
  133: { category: 'artificialColors', name: 'Brilliant Blue FCF (E133 / INS 133, Blue 1)' },
  142: { category: 'artificialColors', name: 'Green S (E142 / INS 142)' },
  143: { category: 'artificialColors', name: 'Fast Green FCF (E143 / INS 143)' },
  151: { category: 'artificialColors', name: 'Brilliant Black (E151 / INS 151)' },
  155: { category: 'artificialColors', name: 'Brown HT (E155 / INS 155)' },
  202: { category: 'otherPreservatives', name: 'Potassium Sorbate (E202 / INS 202)' },
  211: { category: 'otherPreservatives', name: 'Sodium Benzoate (E211 / INS 211)' },
  220: { category: 'otherPreservatives', name: 'Sulfur Dioxide (E220 / INS 220)' },
  221: { category: 'otherPreservatives', name: 'Sodium Sulfite (E221 / INS 221)' },
  223: { category: 'otherPreservatives', name: 'Sodium Metabisulfite (E223 / INS 223)' },
  249: { category: 'nitritesNitrates', name: 'Potassium Nitrite (E249 / INS 249)' },
  250: { category: 'nitritesNitrates', name: 'Sodium Nitrite (E250 / INS 250)' },
  251: { category: 'nitritesNitrates', name: 'Sodium Nitrate (E251 / INS 251)' },
  252: { category: 'nitritesNitrates', name: 'Potassium Nitrate (E252 / INS 252)' },
  319: { category: 'otherPreservatives', name: 'TBHQ (E319 / INS 319)' },
  320: { category: 'otherPreservatives', name: 'BHA (E320 / INS 320)' },
  321: { category: 'otherPreservatives', name: 'BHT (E321 / INS 321)' },
  621: { category: 'flavorEnhancers', name: 'Monosodium Glutamate (E621 / INS 621, MSG)' },
  622: { category: 'flavorEnhancers', name: 'Monopotassium Glutamate (E622 / INS 622)' },
  623: { category: 'flavorEnhancers', name: 'Calcium Diglutamate (E623 / INS 623)' },
  627: { category: 'flavorEnhancers', name: 'Disodium Guanylate (E627 / INS 627)' },
  631: { category: 'flavorEnhancers', name: 'Disodium Inosinate (E631 / INS 631)' },
  635: { category: 'flavorEnhancers', name: "Disodium 5'-Ribonucleotides (E635 / INS 635)" },
  950: { category: 'artificialSweeteners', name: 'Acesulfame K (E950 / INS 950)' },
  951: { category: 'artificialSweeteners', name: 'Aspartame (E951 / INS 951)' },
  954: { category: 'artificialSweeteners', name: 'Saccharin (E954 / INS 954)' },
  955: { category: 'artificialSweeteners', name: 'Sucralose (E955 / INS 955)' },
  961: { category: 'artificialSweeteners', name: 'Neotame (E961 / INS 961)' },
  962: { category: 'artificialSweeteners', name: 'Aspartame-Acesulfame Salt (E962 / INS 962)' },
};

// Matches "E102", "E-102", "E 102", "INS 102", "INS102".
const E_NUMBER_PATTERN = /\b(?:e|ins)[\s-]?(\d{3})\b/gi;

function detectENumbers(ingredients) {
  const result = {};
  for (const ingredient of ingredients || []) {
    const normalized = normalizeOcrText(ingredient.toLowerCase());
    E_NUMBER_PATTERN.lastIndex = 0;
    let match = E_NUMBER_PATTERN.exec(normalized);
    while (match !== null) {
      const entry = E_NUMBER_MAP[Number(match[1])];
      if (entry) {
        if (!result[entry.category]) result[entry.category] = [];
        if (!result[entry.category].includes(entry.name)) result[entry.category].push(entry.name);
      }
      match = E_NUMBER_PATTERN.exec(normalized);
    }
  }
  return result;
}

// Detects additive categories present in the ingredients list, returning
// which specific ingredient strings triggered each category (for display
// and for the LLM prompt), not just a boolean. Combines named-keyword
// matching (OCR-tolerant) with E-number/INS-number matching.
function detectAdditives(ingredients) {
  const result = {};
  const merge = (category, value) => {
    if (!result[category]) result[category] = [];
    if (!result[category].includes(value)) result[category].push(value);
  };

  for (const ingredient of ingredients || []) {
    const normalized = normalizeOcrText(ingredient.toLowerCase());
    for (const [category, keywords] of Object.entries(ADDITIVE_KEYWORDS)) {
      for (const kw of keywords) {
        if (fuzzyIncludes(normalized, kw)) {
          merge(category, ingredient);
          break;
        }
      }
    }
  }

  const eNumberHits = detectENumbers(ingredients);
  for (const [category, names] of Object.entries(eNumberHits)) {
    for (const name of names) merge(category, name);
  }

  return result;
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

/**
 * calculateHealthScore
 *
 * Previously this only looked at 4 macros by %DV and never saw the
 * ingredients list at all, which let a snack with artificial colors and
 * high sodium score 98/100 "Excellent" while the separate LLM note called
 * the same item "generally unhealthy" — the two never shared any data.
 * This version folds in every signal the report actually displays
 * (trans fat, added sugar, additives, and NOVA processing group when
 * available) so the number and the narrative can't diverge.
 *
 * @param {object} dv          %DV map from calculateDailyValuePercent()
 * @param {object} nutrition   raw parsed nutrition amounts
 * @param {object} [additives] output of detectAdditives(ingredients)
 * @param {number|null} [novaGroup] OpenFoodFacts NOVA group (1-4), if known
 */
function calculateHealthScore(dv, nutrition, additives = {}, novaGroup = null) {
  if (!nutrition || Object.keys(nutrition).length === 0) {
    return { score: null, label: 'N/A (no nutrition data extracted)', breakdown: [] };
  }

  let score = 100;
  const breakdown = [];

  const record = (delta, reason) => {
    if (delta === 0) return;
    score += delta;
    breakdown.push({ delta: Math.round(delta * 10) / 10, reason });
  };

  // --- %DV-proportional macro penalties -----------------------------------
  // Penalize proportionally to the FULL %DV (not just the amount over 20%),
  // so a nutrient already at 40-48% DV meaningfully drags the score down
  // instead of only costing a few points for the excess above 20%.
  // Sodium and sugar weights were raised from the original 0.2/0.5: at the
  // old sodium weight, a snack could carry ~8% of a whole day's sodium DV
  // and lose barely 1-2 points, which is what let this happen. Sugar is
  // now split between total sugars and added sugars specifically, since
  // WHO/AHA guidance calls out added sugar as the more actionable concern.
  const negatives = [
    ['saturated_fat_g', 0.6, 'saturated fat'],
    ['sodium_mg', 0.4, 'sodium'],
    ['total_sugars_g', 0.35, 'total sugars'],
    ['added_sugars_g', 0.35, 'added sugars'],
    ['cholesterol_mg', 0.2, 'cholesterol'],
  ];
  for (const [key, weight, label] of negatives) {
    const pct = dv[key] || 0;
    if (pct > 0) record(-(pct * weight), `${label}: ${pct}% DV`);
  }

  // --- Trans fat --------------------------------------------------------
  // No official %DV exists for trans fat because FDA/WHO guidance is to
  // minimize it entirely, so it was silently skipped before. Any measurable
  // amount is treated as a serious red flag.
  const transFat = nutrition.trans_fat_g || 0;
  if (transFat > 0) {
    record(-Math.min(25, transFat * 25), `trans fat: ${transFat}g (any amount is a concern)`);
  }
  // Labels can round trans fat down to "0g" if under 0.5g/serving even when
  // partially hydrogenated oil is in the ingredients — catch that loophole.
  if (transFat === 0 && additives.hydrogenatedOils) {
    record(-10, 'hydrogenated/partially hydrogenated oil in ingredients (possible hidden trans fat)');
  }

  // --- Ingredient-based additives ----------------------------------------
  if (additives.artificialColors) {
    record(-Math.min(18, additives.artificialColors.length * 6), `artificial color(s): ${additives.artificialColors.join(', ')}`);
  }
  if (additives.artificialSweeteners) {
    record(-Math.min(10, additives.artificialSweeteners.length * 5), `artificial sweetener(s): ${additives.artificialSweeteners.join(', ')}`);
  }
  if (additives.nitritesNitrates) {
    record(-8, `nitrite/nitrate preservative(s): ${additives.nitritesNitrates.join(', ')}`);
  }
  if (additives.otherPreservatives) {
    record(-Math.min(9, additives.otherPreservatives.length * 3), `preservative(s): ${additives.otherPreservatives.join(', ')}`);
  }
  if (additives.flavorEnhancers) {
    record(-Math.min(9, additives.flavorEnhancers.length * 3), `flavor enhancer(s): ${additives.flavorEnhancers.join(', ')}`);
  }

  // --- Cumulative additive load ("looks ultra-processed" heuristic) --------
  // A single flagged additive category taken alone might look mild, but a
  // food carrying several DIFFERENT kinds at once (colors + preservatives +
  // flavor enhancers together, as in this example) is a strong real-world
  // signal of heavy industrial processing — the same thing NOVA group 4
  // captures officially. We only apply this when we don't already have an
  // official NOVA group (from a barcode match), to avoid double-penalizing.
  if (novaGroup === null) {
    const totalAdditiveHits = Object.values(additives).reduce((sum, arr) => sum + arr.length, 0);
    const processingPenalty = Math.min(20, Math.max(0, (totalAdditiveHits - 2) * 4));
    if (processingPenalty > 0) {
      record(-processingPenalty, `${totalAdditiveHits} additive(s) detected across multiple categories — signals heavy processing`);
    }
  }

  // --- NOVA processing group (only when a barcode/OpenFoodFacts match exists)
  if (novaGroup === 1) record(5, 'NOVA 1: unprocessed/minimally processed');
  else if (novaGroup === 3) record(-5, 'NOVA 3: processed food');
  else if (novaGroup === 4) record(-15, 'NOVA 4: ultra-processed food');

  // --- Positive nutrients ---------------------------------------------------
  // Small bonus for nutrients that are genuinely beneficial in quantity,
  // so high-fiber/high-protein foods aren't scored the same as empty-calorie ones.
  const positives = [
    ['fiber_g', 20, 5, 'fiber'],
    ['protein_g', 20, 5, 'protein'],
  ];
  for (const [key, threshold, bonus, label] of positives) {
    const pct = dv[key] || 0;
    if (pct >= threshold) record(bonus, `good source of ${label}: ${pct}% DV`);
    else if (pct >= threshold / 2) record(bonus / 2, `moderate source of ${label}: ${pct}% DV`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label;
  if (score >= 80) label = 'Excellent';
  else if (score >= 60) label = 'Good';
  else if (score >= 40) label = 'Moderate';
  else label = 'Poor';
  return { score, label, breakdown };
}

module.exports = {
  parseNutrition, parseIngredients, detectAllergens, detectAdditives,
  calculateDailyValuePercent, calculateHealthScore,
  DAILY_VALUES, cleanNum,
};
