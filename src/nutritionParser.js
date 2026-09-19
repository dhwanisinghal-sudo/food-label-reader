/**
 * nutritionParser.js
 * Ported from the Python notebook logic — same OCR-misread fixes:
 *  - digit/letter confusion (0<->O, l<->1)
 *  - unit char fused into the number (e.g. "8g" OCR'd as "89", "2g" as "29")
 *  - %DV cross-check to self-correct garbled amounts
 *
 * Verified against real Tesseract output (not just assumed OCR noise): ran
 * the actual server preprocessing pipeline (sharp resize->2000px, jpeg q88)
 * + `tesseract --psm 3 --oem 1` against a real nutrition label photo. Real
 * output included lines like "Total Fat 89 12%", "Total Carbohydrate 189",
 * "Protein 29" — Tesseract is fusing the "g" unit glyph into the number as
 * a trailing "9" far more often than it was previously given credit for.
 * The old unit classes ([g)], [g3]) had no tolerance for that at all, so
 * those fields silently failed to match and showed as "Not detected".
 */

const DAILY_VALUES = {
  calories: 2000, total_fat_g: 78, saturated_fat_g: 20,
  cholesterol_mg: 300, sodium_mg: 2300, total_carbs_g: 275,
  fiber_g: 28, total_sugars_g: 50, added_sugars_g: 50, protein_g: 50,
  // FDA 2020 label reference values for the micronutrients added below.
  vitamin_d_mcg: 20, calcium_mg: 1300, iron_mg: 18, potassium_mg: 4700,
};

// FDA establishes FOUR separate sets of Daily Values by population group
// (21 CFR 101.9) — this app supports the three relevant to people actually
// eating solid food. Figures verified directly against 21 CFR 101.9 (Sep
// 2026). "adults_children_4plus" duplicates DAILY_VALUES above so callers
// can always look up a group by name, including the default.
const AGE_GROUP_DAILY_VALUES = {
  adults_children_4plus: { ...DAILY_VALUES },
  // FDA reference for children 1 through 3 years of age.
  children_1_3: {
    calories: 1000, // informal reference (not an FDA %DV entry) for display only
    total_fat_g: 39, saturated_fat_g: 10, cholesterol_mg: 300, sodium_mg: 1500,
    total_carbs_g: 150, fiber_g: 14, total_sugars_g: 50, added_sugars_g: 25,
    protein_g: 13, vitamin_d_mcg: 15, calcium_mg: 700, iron_mg: 7, potassium_mg: 3000,
  },
  // FDA reference for pregnant and lactating women.
  pregnant_lactating: {
    calories: 2200, // informal reference (not an FDA %DV entry) for display only
    total_fat_g: 78, saturated_fat_g: 20, cholesterol_mg: 300, sodium_mg: 2300,
    total_carbs_g: 275, fiber_g: 28, total_sugars_g: 50, added_sugars_g: 50,
    protein_g: 71, vitamin_d_mcg: 15, calcium_mg: 1300, iron_mg: 27, potassium_mg: 5100,
  },
};

const PLAUSIBLE_RANGE = {
  calories: [0, 2000], total_fat_g: [0, 100], saturated_fat_g: [0, 60],
  trans_fat_g: [0, 20], cholesterol_mg: [0, 500], sodium_mg: [0, 5000],
  total_carbs_g: [0, 150], fiber_g: [0, 60], total_sugars_g: [0, 150],
  added_sugars_g: [0, 150], protein_g: [0, 100],
  vitamin_d_mcg: [0, 100], calcium_mg: [0, 2000], iron_mg: [0, 50], potassium_mg: [0, 6000],
};

const NUM = '([0-9OoIl]+\\.?[0-9]*)';

const G_UNIT = '[g)93]';
const MG_UNIT = 'm[ga9]';

// Dual-column labels ("Per Serving | Per Container", e.g. single-serve
// pints/tubs) print the SAME nutrient twice on one line, e.g.
// "Total Fat 20g 61g 26% 78%". This appends an OPTIONAL second
// number+unit capture right after the first, so:
//   - single-column labels (the overwhelming majority) match exactly as
//     before — the optional group simply never matches, zero behavior
//     change (verified by the existing single-column test suite still
//     passing unmodified).
//   - dual-column labels where both amounts appear back-to-back
//     ("20g 61g ...") capture the per-container amount into group 2.
//   - dual-column labels where each amount is immediately followed by its
//     own %DV ("20g 26% 61g 78%") do NOT match group 2 here (the next
//     token is a "%", not a unit) — this is a deliberate, safe
//     degradation: we still get the correct per-serving amount, we just
//     don't also capture the per-container figure for that layout. This
//     is untested against real dual-column OCR output (no sample was
//     available), so both plausible orderings are covered defensively
//     rather than assuming one.
function withOptionalSecondValue(unitClass, strictUnitClass) {
  return NUM + '\\s*' + unitClass + '(?:\\s+' + NUM + '\\s*' + strictUnitClass + ')?';
}
// The SECOND value always uses a STRICT unit (literal "g"/"mg" only, no
// digit-fusion fallback chars). G_UNIT/MG_UNIT include "9"/"3"/"a" to
// recover a unit OCR mangled into a trailing digit right after THE FIRST
// number on a line — reusing that same tolerant class for the second
// capture turned out to consume part of a following percent sign instead
// (e.g. "10g 13%" was misread as a second value "1" with unit "3"),
// caught by this file's own test suite while building this. A genuine
// per-container value OCR'd with a similarly mangled unit simply won't be
// captured (no perContainer for that field) rather than risk a wrong one.
const G_UNIT_STRICT = '[g)]';
const MG_UNIT_STRICT = 'mg';

const PATTERNS = {
  calories: new RegExp('(?:calories|energy)\\s*(?:k?cal)?\\s*[:.]?\\s*(?:[\\d.]+\\s*kj\\s*[/,]?\\s*)?' + NUM + '\\s*(?:k?cal)?', 'i'),
  // Scoped to the 9 core macro fields most commonly duplicated on
  // dual-column ("Per Serving | Per Container") labels — see
  // withOptionalSecondValue above. Micronutrients and calories are left
  // as single-capture (calories already has its own multi-format
  // handling; extending it further without a real dual-column sample to
  // test against risks misreading unrelated numbers as a second value).
  total_fat_g: new RegExp('(?:total\\s*fat|(?<!saturated\\s)(?<!trans\\s)\\bfat)\\s*[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  saturated_fat_g: new RegExp('(?:saturated fat|(?:of which\\s*)?saturates)\\s*[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  trans_fat_g: new RegExp('trans fat\\s*[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  cholesterol_mg: new RegExp('cholesterol\\s*[:.]?\\s*' + withOptionalSecondValue(MG_UNIT, MG_UNIT_STRICT), 'i'),
  sodium_mg: new RegExp('sodium\\s*[:.]?\\s*' + withOptionalSecondValue(MG_UNIT, MG_UNIT_STRICT), 'i'),
  total_carbs_g: new RegExp('(?:total\\s*)?carboh[yi]d[nr]ate\\s*[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  fiber_g: new RegExp('(?:dietary\\s*)?fib(?:er|re)\\s*(?:less than\\s*)?[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  total_sugars_g: new RegExp('(?:total\\s+|of which\\s*)?(?<!added\\s)sugars?\\s*(?:less than\\s*)?[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  added_sugars_g: new RegExp('includes\\s*' + NUM + '\\s*' + G_UNIT + '\\s*added sugars', 'i'),
  protein_g: new RegExp('protein\\s*[:.]?\\s*' + withOptionalSecondValue(G_UNIT, G_UNIT_STRICT), 'i'),
  vitamin_d_mcg: new RegExp('vitamin\\s*d\\s*[:.]?\\s*' + NUM + '\\s*mc[g9]', 'i'),
  calcium_mg: new RegExp('calcium\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  iron_mg: new RegExp('iron\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  potassium_mg: new RegExp('potassium\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
};

// Fields extended with an optional per-container second capture (group 2
// in their pattern) — used by parseNutrition to know which matches may
// have a meaningful match[2].
const DUAL_COLUMN_FIELDS = new Set([
  'total_fat_g', 'saturated_fat_g', 'trans_fat_g', 'cholesterol_mg',
  'sodium_mg', 'total_carbs_g', 'fiber_g', 'total_sugars_g', 'protein_g',
]);

const SALT_PATTERN = new RegExp('salt\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i');

function cleanNum(raw) {
  const fixed = raw.replace(/O/g, '0').replace(/o/g, '0').replace(/I/g, '1').replace(/l/g, '1');
  const value = parseFloat(fixed);
  return Number.isNaN(value) ? null : value;
}

function parseNutrition(text) {
  const data = {};
  const corrections = [];
  const perContainer = {};

  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const match = text.match(pattern);
    if (!match) continue;

    let value = cleanNum(match[1]);
    if (value === null) continue;

    const [lo, hi] = PLAUSIBLE_RANGE[key] || [0, Infinity];
    if (value < lo || value > hi) continue;

    // Dual-column ("Per Serving | Per Container") labels print this same
    // nutrient a second time on the same line — captured optionally as
    // match[2] by withOptionalSecondValue (see PATTERNS). Kept separate
    // from the primary per-serving `value` used everywhere else (%DV,
    // health score) so a per-container figure never gets treated as the
    // per-serving amount.
    if (DUAL_COLUMN_FIELDS.has(key) && match[2] !== undefined) {
      const perContainerValue = cleanNum(match[2]);
      if (perContainerValue !== null && perContainerValue >= lo && perContainerValue <= hi) {
        perContainer[key] = perContainerValue;
      }
    }

    if (key in DAILY_VALUES) {
      const afterMatch = text.slice(match.index + match[0].length);
      const newlineIdx = afterMatch.indexOf('\n');
      const windowEnd = newlineIdx === -1 ? 15 : Math.min(15, newlineIdx);
      const window = afterMatch.slice(0, windowEnd);
      const pctMatch = window.match(/(\d{1,3})\s*%/);
      if (pctMatch) {
        const declaredPct = parseFloat(pctMatch[1]);
        const ourPct = (value / DAILY_VALUES[key]) * 100;
        if (declaredPct > 0 && ourPct > 0) {
          const ratio = ourPct / declaredPct;
          if (ratio > 4 || ratio < 0.25) {
            const corrected = Math.round((declaredPct / 100) * DAILY_VALUES[key] * 100) / 100;
            corrections.push({
              field: key, from: value, to: corrected, reason: `%DV cross-check (declared ${declaredPct}%)`,
            });
            value = corrected;
          }
        }
      }
    }

    data[key] = key === 'calories' ? Math.round(value) : value;
  }

  if (Object.keys(perContainer).length) {
    data.perContainer = perContainer;
    // Explicit flag (rather than making callers infer it from the
    // presence of `perContainer`) so the frontend/report can show a
    // "this label lists Per Serving and Per Container values — Per
    // Serving is used here" note without extra logic.
    data.dualColumnLabel = true;
  }

  if (data.sodium_mg == null) {
    const saltMatch = text.match(SALT_PATTERN);
    if (saltMatch) {
      const saltG = cleanNum(saltMatch[1]);
      if (saltG !== null && saltG >= 0 && saltG <= 20) {
        data.sodium_mg = Math.round(saltG * 400);
        corrections.push({
          field: 'sodium_mg', from: null, to: data.sodium_mg,
          reason: `derived from printed salt value (${saltG}g × 400)`,
        });
      }
    }
  }

  const servingMatch = text.match(/serving size\s*([^\n]+)/i);
  if (servingMatch) data.serving_size = servingMatch[1].trim();

  if (corrections.length) data.corrections = corrections;

  return data;
}

function parseIngredients(text) {
  const startMatch = text.match(/ingredients\s*:?/i);
  if (!startMatch) return [];

  let cleaned = text.slice(startMatch.index + startMatch[0].length).trim();

  const stopPatterns = [
    /nutrition facts/i, /serving size/i,
    /contains\s*:?\s*-?\s*(milk|soy|wheat|egg|nuts?|tree nuts?)/i,
    /percent daily values/i, /calories from fat/i, /%\s*daily value/i,
  ];
  let cutIdx = cleaned.length;
  for (const pat of stopPatterns) {
    const m = cleaned.match(pat);
    if (m && m.index < cutIdx) cutIdx = m.index;
  }
  cleaned = cleaned.slice(0, cutIdx).trim();
  cleaned = cleaned.replace(/\s*\n\s*/g, ' ');

  return splitTopLevelCommas(cleaned)
    .map((item) => item.trim().replace(/^\.+|\.+$/g, ''))
    .map((item) => item.replace(/^(?:and|or)\s+/i, '').trim())
    .filter((item) => item.length > 0 && item.length <= 120);
}

function splitTopLevelCommas(text) {
  const items = [];
  let current = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current);
  return items;
}

const ALLERGEN_KEYWORDS = {
  'Milk/Dairy': ['milk', 'dairy', 'lactose', 'casein', 'whey', 'butter', 'cream', 'cheese'],
  Soy: ['soy', 'soya', 'soybean'],
  'Wheat/Gluten': ['wheat', 'gluten', 'barley', 'rye', 'flour'],
  Nuts: ['almond', 'cashew', 'walnut', 'peanut', 'pistachio', 'hazelnut'],
  Egg: ['egg', 'albumin'],
  Sesame: ['sesame', 'tahini'],
};

const ADDITIVE_KEYWORDS = {
  artificialColors: ['red 40', 'red 3', 'yellow 5', 'yellow 6', 'blue 1', 'blue 2', 'green 3'],
  artificialSweeteners: ['aspartame', 'sucralose', 'acesulfame', 'saccharin', 'neotame', 'advantame'],
  nitritesNitrates: ['sodium nitrite', 'sodium nitrate', 'potassium nitrite', 'potassium nitrate'],
  otherPreservatives: ['bht', 'bha', 'tbhq', 'sodium benzoate', 'potassium sorbate', 'sodium metabisulfite', 'sulfur dioxide', 'propyl gallate'],
  hydrogenatedOils: ['partially hydrogenated', 'hydrogenated vegetable oil', 'hydrogenated palm oil', 'hydrogenated soybean oil', 'hydrogenated cottonseed oil'],
  flavorEnhancers: ['msg', 'monosodium glutamate', 'disodium inosinate', 'disodium guanylate', "disodium 5'-ribonucleotides"],
};

function detectAdditives(ingredients) {
  const detected = {};
  for (const ingredient of ingredients) {
    const lower = ingredient.toLowerCase();
    for (const [category, keywords] of Object.entries(ADDITIVE_KEYWORDS)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        if (!detected[category]) detected[category] = [];
        if (!detected[category].includes(ingredient)) detected[category].push(ingredient);
      }
    }
  }
  return detected;
}

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

const VEGAN_CONFLICT_KEYWORDS = ['milk', 'whey', 'casein', 'egg', 'honey', 'gelatin', 'lard', 'meat', 'fish', 'chicken', 'beef', 'pork'];
const VEGETARIAN_CONFLICT_KEYWORDS = ['gelatin', 'lard', 'meat', 'fish', 'chicken', 'beef', 'pork', 'rennet'];
const NON_HALAL_KOSHER_KEYWORDS = ['pork', 'lard', 'gelatin', 'alcohol', 'wine', 'rum', 'bacon', 'ham'];
const HIGH_CARB_KEYWORDS = ['sugar', 'corn syrup', 'wheat flour', 'rice', 'maltodextrin', 'dextrose'];
const PALEO_CONFLICT_KEYWORDS = ['sugar', 'wheat', 'corn', 'dairy', 'milk', 'legume', 'soy', 'peanut', 'artificial'];
const FODMAP_CONFLICT_KEYWORDS = ['garlic', 'onion', 'honey', 'high fructose corn syrup', 'wheat', 'inulin', 'sorbitol', 'xylitol'];

function checkDietCompatibility(ingredients) {
  const text = ingredients.join(' ').toLowerCase();
  const veganConflicts = VEGAN_CONFLICT_KEYWORDS.filter((kw) => text.includes(kw));
  const vegetarianConflicts = VEGETARIAN_CONFLICT_KEYWORDS.filter((kw) => text.includes(kw));
  return {
    veganFriendly: veganConflicts.length === 0,
    veganConflicts,
    vegetarianFriendly: vegetarianConflicts.length === 0,
    vegetarianConflicts,
  };
}

function checkHalalKosher(ingredients) {
  const text = ingredients.join(' ').toLowerCase();
  const conflicts = NON_HALAL_KOSHER_KEYWORDS.filter((kw) => text.includes(kw));
  return { halalKosherSafe: conflicts.length === 0, conflicts };
}

function checkKetoCompatibility(nutrition, ingredients) {
  const carbs = nutrition.total_carbs_g || 0;
  const fiber = nutrition.fiber_g || 0;
  const netCarbs = Math.max(carbs - fiber, 0);
  const text = ingredients.join(' ').toLowerCase();
  const conflicts = HIGH_CARB_KEYWORDS.filter((kw) => text.includes(kw));
  return { ketoFriendly: netCarbs <= 10 && conflicts.length === 0, netCarbsG: netCarbs, conflicts };
}

function checkPaleoCompatibility(ingredients) {
  const text = ingredients.join(' ').toLowerCase();
  const conflicts = PALEO_CONFLICT_KEYWORDS.filter((kw) => text.includes(kw));
  return { paleoFriendly: conflicts.length === 0, conflicts };
}

function checkFodmapCompatibility(ingredients) {
  const text = ingredients.join(' ').toLowerCase();
  const conflicts = FODMAP_CONFLICT_KEYWORDS.filter((kw) => text.includes(kw));
  return { lowFodmap: conflicts.length === 0, conflicts };
}

function checkAllDietCompatibility(nutrition, ingredients) {
  if (!ingredients || ingredients.length === 0) return null;
  const diet = checkDietCompatibility(ingredients);
  const halalKosher = checkHalalKosher(ingredients);
  const keto = checkKetoCompatibility(nutrition || {}, ingredients);
  const paleo = checkPaleoCompatibility(ingredients);
  const fodmap = checkFodmapCompatibility(ingredients);
  return {
    vegan: { friendly: diet.veganFriendly, conflicts: diet.veganConflicts },
    vegetarian: { friendly: diet.vegetarianFriendly, conflicts: diet.vegetarianConflicts },
    halalKosher: { friendly: halalKosher.halalKosherSafe, conflicts: halalKosher.conflicts },
    keto: { friendly: keto.ketoFriendly, netCarbsG: keto.netCarbsG, conflicts: keto.conflicts },
    paleo: { friendly: paleo.paleoFriendly, conflicts: paleo.conflicts },
    lowFodmap: { friendly: fodmap.lowFodmap, conflicts: fodmap.conflicts },
  };
}

function calculateDailyValuePercent(nutrition, ageGroup = 'adults_children_4plus') {
  const table = AGE_GROUP_DAILY_VALUES[ageGroup] || DAILY_VALUES;
  const dv = {};
  for (const [key, amount] of Object.entries(nutrition)) {
    if (key in table && amount != null) {
      dv[key] = Math.round((amount / table[key]) * 1000) / 10;
    }
  }
  return dv;
}

const ADDITIVE_CATEGORY_LABELS = {
  artificialColors: 'artificial colors',
  artificialSweeteners: 'artificial sweeteners',
  nitritesNitrates: 'nitrite/nitrate preservatives',
  otherPreservatives: 'preservatives',
  hydrogenatedOils: 'partially hydrogenated oil',
  flavorEnhancers: 'flavor enhancers',
};

const ADDITIVE_INFO = {
  artificialColors: 'Synthetic dyes added purely for appearance. Some (e.g. Red 40, Yellow 5) are under regulatory review in various countries over possible links to hyperactivity in sensitive children.',
  artificialSweeteners: 'Low- or zero-calorie sugar substitutes used to sweeten food without adding sugar or calories. Considered safe in typical amounts by the FDA and EFSA.',
  nitritesNitrates: 'Preservatives that prevent bacterial growth (including botulism) and preserve color in cured meats. Can form nitrosamines, compounds linked to increased cancer risk with frequent, high intake.',
  otherPreservatives: 'Used to extend shelf life and prevent spoilage or oxidation. Generally recognized as safe (GRAS) at the levels typically used in food.',
  hydrogenatedOils: 'A source of trans fats, which raise LDL ("bad") cholesterol and are linked to increased heart disease risk. The FDA has restricted their use in the US food supply.',
  flavorEnhancers: 'Used to intensify savory taste. Generally recognized as safe, though some people report sensitivity (e.g. headaches) to MSG in large amounts.',
};

function calculateHealthScore(dv, nutrition, additives = {}, novaGroup = null, nutriscoreGrade = null) {
  if (!nutrition || Object.keys(nutrition).length === 0) {
    return { score: null, label: 'N/A (no nutrition data extracted)', breakdown: [] };
  }

  let score = 100;
  const breakdown = [];

  const negatives = [
    ['saturated_fat_g', 0.3, 'Saturated fat'],
    ['total_sugars_g', 0.3, 'Sugars'],
    ['sodium_mg', 0.2, 'Sodium'],
  ];
  for (const [key, weight, label] of negatives) {
    const pct = dv[key] || 0;
    if (pct > 20) {
      const delta = -Math.round((pct - 20) * weight * 10) / 10;
      score += delta;
      breakdown.push({ delta, reason: `${label} at ${pct}% daily value (>20% threshold)` });
    }
  }

  if (novaGroup === 4) {
    score -= 15;
    breakdown.push({ delta: -15, reason: 'NOVA group 4 — ultra-processed food' });
  } else if (novaGroup === 3) {
    score -= 7;
    breakdown.push({ delta: -7, reason: 'NOVA group 3 — processed food' });
  }

  const gradePenalty = { a: 0, b: 5, c: 12, d: 20, e: 28 };
  const grade = (nutriscoreGrade || '').toLowerCase();
  const penalty = Object.prototype.hasOwnProperty.call(gradePenalty, grade) ? gradePenalty[grade] : 10;
  if (penalty > 0) {
    score -= penalty;
    breakdown.push({ delta: -penalty, reason: grade ? `Nutri-Score grade ${grade.toUpperCase()}` : 'Nutri-Score unknown' });
  }

  const additiveCategories = Object.keys(additives || {}).filter(
    (k) => additives[k] && additives[k].length,
  );
  if (additiveCategories.length) {
    const delta = -Math.min(additiveCategories.length * 3, 15);
    score += delta;
    const names = additiveCategories.map((k) => ADDITIVE_CATEGORY_LABELS[k] || k).join(', ');
    breakdown.push({ delta, reason: `Contains ${names}` });
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
  checkDietCompatibility, checkHalalKosher, checkKetoCompatibility,
  checkPaleoCompatibility, checkFodmapCompatibility, checkAllDietCompatibility,
  DAILY_VALUES, AGE_GROUP_DAILY_VALUES, cleanNum, splitTopLevelCommas, ADDITIVE_INFO,
};
