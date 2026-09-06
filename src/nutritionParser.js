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

// Gram unit: real "g", a stray ")" from column formatting, OR the digits
// "9"/"3" that Tesseract commonly substitutes for a lowercase "g" glyph
// (confirmed via direct OCR testing — see header comment). Because NUM is
// greedy, the regex engine only backtracks into treating a trailing digit
// as "actually the unit char" when the strict [g)] read fails, so adding
// 9/3 here does not cause any legitimate multi-digit number to be
// truncated — a real "19g" still matches "19" via the literal g branch
// before backtracking would ever be attempted.
const G_UNIT = '[g)93]';
// mg unit: tolerate the same g->9 confusion in "mg".
const MG_UNIT = 'm[ga9]';

const PATTERNS = {
  // Handles three energy formats in one pattern, always capturing the KCAL
  // value in group 1 (never the kJ value):
  //   "Calories 240"              (US)
  //   "Energy KCAL : 101 KCAL"    (India, already fixed above)
  //   "Energy 1046kJ/250kcal"     (EU/UK/AU — combined kJ+kcal)
  // The optional non-capturing group consumes a leading "<n>kJ/" or
  // "<n>kJ " so that NUM only ever captures the kcal figure, never kJ.
  calories: new RegExp('(?:calories|energy)\\s*(?:k?cal)?\\s*[:.]?\\s*(?:[\\d.]+\\s*kj\\s*[/,]?\\s*)?' + NUM + '\\s*(?:k?cal)?', 'i'),
  // Accepts "Total Fat" (US) OR a bare "Fat" that is NOT preceded by
  // "saturated"/"trans" (common on Indian labels, e.g. "FAT : 12.4g"),
  // so it won't accidentally grab the saturated/trans fat value instead.
  total_fat_g: new RegExp('(?:total\\s*fat|(?<!saturated\\s)(?<!trans\\s)\\bfat)\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  // "Saturated Fat" (US/India) or "of which saturates"/"saturates" (EU/UK/AU).
  saturated_fat_g: new RegExp('(?:saturated fat|(?:of which\\s*)?saturates)\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  trans_fat_g: new RegExp('trans fat\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  cholesterol_mg: new RegExp('cholesterol\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  sodium_mg: new RegExp('sodium\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  // "Total Carbohydrate" (US) or bare "Carbohydrate" (common elsewhere).
  total_carbs_g: new RegExp('(?:total\\s*)?carboh[yi]d[nr]ate\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  fiber_g: new RegExp('(?:dietary\\s*)?fib(?:er|re)\\s*(?:less than\\s*)?[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  // "Total Sugars"/"Sugars" (US, plural), bare "Sugar" (singular, India),
  // or "of which sugars" (EU/UK/AU) — (?<!added\s) stops this from also
  // matching inside "Added Sugars", which has its own pattern below.
  total_sugars_g: new RegExp('(?:total\\s+|of which\\s*)?(?<!added\\s)sugars?\\s*(?:less than\\s*)?[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  added_sugars_g: new RegExp('includes\\s*' + NUM + '\\s*' + G_UNIT + '\\s*added sugars', 'i'),
  protein_g: new RegExp('protein\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i'),
  // Micronutrients — these were previously extracted by OCR (visible in
  // extractedText) but never captured into `nutrition`, so real labels
  // that print them (nearly all US labels do) silently lost this data.
  vitamin_d_mcg: new RegExp('vitamin\\s*d\\s*[:.]?\\s*' + NUM + '\\s*mc[g9]', 'i'),
  calcium_mg: new RegExp('calcium\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  iron_mg: new RegExp('iron\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
  potassium_mg: new RegExp('potassium\\s*[:.]?\\s*' + NUM + '\\s*' + MG_UNIT, 'i'),
};

// EU/UK/AU labels print "Salt" instead of "Sodium" (salt = sodium × 2.5 by
// mass, so sodium(mg) = salt(g) × 400). This is checked separately, only
// as a fallback when no direct "Sodium" line was found, since a label
// should never print both.
const SALT_PATTERN = new RegExp('salt\\s*[:.]?\\s*' + NUM + '\\s*' + G_UNIT, 'i');

function cleanNum(raw) {
  const fixed = raw.replace(/O/g, '0').replace(/o/g, '0').replace(/I/g, '1').replace(/l/g, '1');
  const value = parseFloat(fixed);
  return Number.isNaN(value) ? null : value;
}

function parseNutrition(text) {
  const data = {};
  const corrections = [];

  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const match = text.match(pattern);
    if (!match) continue;

    let value = cleanNum(match[1]);
    if (value === null) continue;

    const [lo, hi] = PLAUSIBLE_RANGE[key] || [0, Infinity];
    if (value < lo || value > hi) continue;

    if (key in DAILY_VALUES) {
      // %DV lives on the SAME printed line as the amount on every real
      // nutrition label. Bounding the lookahead window at the next
      // newline (in addition to the old 15-char cap) stops the cross-
      // check from reading a % that belongs to the *next* nutrient line
      // — which is what previously turned a correctly-read "Dietary
      // Fiber 2g" into a bogus "1.4g" by borrowing the "5%" off the
      // following/preceding "Saturated Fat 1g 5%" line.
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
          // Only override on a genuinely implausible mismatch (>4x or
          // <0.25x). The old 2.5x/0.4x thresholds were tight enough that
          // ordinary rounding differences between our computed %DV and
          // the label's own printed %DV (which itself rounds) could
          // trigger a "correction" that actually replaced a correct
          // reading with a wrong one derived from a misattributed %.
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

  // EU/UK/AU labels print "Salt", not "Sodium" — only used as a fallback,
  // since a real label prints one or the other, never both.
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

  // Only look at text AFTER the "Ingredients:" label — text before it
  // (e.g. "Serving Size", "Nutrition Facts") must never be scanned for
  // stop patterns, or it truncates the list before it even starts.
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
    // Labels routinely write the final item as "..., and Last Ingredient."
    // — strip a leading conjunction so it doesn't get glued onto the
    // ingredient name itself (e.g. "and Disodium Guanylate").
    .map((item) => item.replace(/^(?:and|or)\s+/i, '').trim())
    .filter((item) => item.length > 0 && item.length <= 120);
}

// Splits on ',' but ONLY at bracket depth 0, so a sub-ingredient list like
// "Vegetable Oil (Corn, Canola, Soybean and/or Sunflower Oil)" or
// "Cheddar Cheese [Milk, Cheese Cultures, Salt, Enzymes]" stays as ONE
// ingredient instead of being torn into separate top-level entries at every
// comma the sub-list happens to contain. Handles both () and [] since real
// labels use either for sub-ingredients/allergen callouts, and tracks depth
// so nested brackets don't close early.
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

// Category keys here MUST match two other places that key off them:
//   - llmNutritionist.js's ADDITIVE_LABELS (turns each category into a
//     human-readable phrase for the rule-based fallback note)
//   - llmNutritionist.js's KNOWN_ADDITIVE_NAMES (every specific compound
//     name below also appears there, so the LLM hallucination-check can
//     name-match against what we actually detected)
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

// ---- Diet compatibility (ported from the notebook's check_*_compatibility
// functions) — all keyword-based against the ingredient list, same approach
// as detectAllergens/detectAdditives above.
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

// Runs all five checks together and returns one compact summary — this is
// the function server.js calls; the individual check* functions above are
// exported too in case any of them are useful standalone.
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

// ageGroup defaults to the standard adult/child-4+ reference — the same
// behavior as before this parameter existed, so every existing caller
// (including the web frontend, which doesn't send ageGroup at all) keeps
// working unchanged.
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

// Short, neutral, factual notes on what each additive category actually is
// and why it's used — not medical advice, just plain-language context so a
// detected additive isn't just an unexplained name on screen.
const ADDITIVE_INFO = {
  artificialColors: 'Synthetic dyes added purely for appearance. Some (e.g. Red 40, Yellow 5) are under regulatory review in various countries over possible links to hyperactivity in sensitive children.',
  artificialSweeteners: 'Low- or zero-calorie sugar substitutes used to sweeten food without adding sugar or calories. Considered safe in typical amounts by the FDA and EFSA.',
  nitritesNitrates: 'Preservatives that prevent bacterial growth (including botulism) and preserve color in cured meats. Can form nitrosamines, compounds linked to increased cancer risk with frequent, high intake.',
  otherPreservatives: 'Used to extend shelf life and prevent spoilage or oxidation. Generally recognized as safe (GRAS) at the levels typically used in food.',
  hydrogenatedOils: 'A source of trans fats, which raise LDL ("bad") cholesterol and are linked to increased heart disease risk. The FDA has restricted their use in the US food supply.',
  flavorEnhancers: 'Used to intensify savory taste. Generally recognized as safe, though some people report sensitivity (e.g. headaches) to MSG in large amounts.',
};

// dv/nutrition are required; additives and novaGroup are optional so this
// still works for callers (and the .py/.ipynb port) that don't have them.
function calculateHealthScore(dv, nutrition, additives = {}, novaGroup = null) {
  if (!nutrition || Object.keys(nutrition).length === 0) {
    return { score: null, label: 'N/A (no nutrition data extracted)', breakdown: [] };
  }

  let score = 100;
  const breakdown = [];

  // Penalize proportionally to the FULL %DV (not just the amount over 20%),
  // so a nutrient that's already at 40-48% DV — nearly half the day's
  // allowance in one serving — meaningfully drags the score down instead
  // of only costing a few points for the excess above 20%.
  const negatives = [
    ['saturated_fat_g', 0.6, 'Saturated fat'],
    ['total_sugars_g', 0.5, 'Sugars'],
    ['sodium_mg', 0.2, 'Sodium'],
    ['cholesterol_mg', 0.2, 'Cholesterol'],
  ];
  for (const [key, weight, label] of negatives) {
    const pct = dv[key] || 0;
    if (pct <= 0) continue;
    const delta = -(Math.round(pct * weight * 10) / 10);
    score += delta;
    breakdown.push({ delta, reason: `${label} at ${pct}% daily value` });
  }

  // Small bonus for nutrients that are genuinely beneficial in quantity,
  // so high-fiber/high-protein foods aren't scored the same as empty-calorie ones.
  const positives = [
    ['fiber_g', 20, 5, 'Fiber'],   // if fiber is >=20% DV, +5
    ['protein_g', 20, 5, 'Protein'], // if protein is >=20% DV, +5
    // Micronutrient bonuses — smaller than fiber/protein since these are
    // "good to have more of" but less impactful on overall diet quality.
    ['vitamin_d_mcg', 20, 2, 'Vitamin D'],
    ['calcium_mg', 20, 2, 'Calcium'],
    ['iron_mg', 20, 2, 'Iron'],
    ['potassium_mg', 20, 2, 'Potassium'],
  ];
  for (const [key, threshold, bonus, label] of positives) {
    const pct = dv[key] || 0;
    if (pct >= threshold) {
      score += bonus;
      breakdown.push({ delta: bonus, reason: `${label} at ${pct}% daily value (≥${threshold}%)` });
    } else if (pct >= threshold / 2) {
      score += bonus / 2;
      breakdown.push({ delta: bonus / 2, reason: `${label} at ${pct}% daily value (≥${threshold / 2}%)` });
    }
  }

  // Additive penalty: -3 points per distinct category detected (colors,
  // sweeteners, nitrites, other preservatives, hydrogenated oils, flavor
  // enhancers), capped at -15 so a handful of categories doesn't zero out
  // an otherwise-fine macro profile.
  const additiveCategories = Object.keys(additives || {}).filter(
    (k) => additives[k] && additives[k].length,
  );
  if (additiveCategories.length) {
    const delta = -Math.min(additiveCategories.length * 3, 15);
    score += delta;
    const names = additiveCategories.map((k) => ADDITIVE_CATEGORY_LABELS[k] || k).join(', ');
    breakdown.push({ delta, reason: `Contains ${names}` });
  }

  // NOVA processing group (from OpenFoodFacts, only present when a barcode
  // was matched): 1 = unprocessed/minimally processed ... 4 = ultra-processed,
  // which is independently associated with worse health outcomes even when
  // the macro numbers look fine.
  if (novaGroup === 4) {
    score -= 10;
    breakdown.push({ delta: -10, reason: 'NOVA group 4 — ultra-processed food' });
  } else if (novaGroup === 3) {
    score -= 4;
    breakdown.push({ delta: -4, reason: 'NOVA group 3 — processed food' });
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
