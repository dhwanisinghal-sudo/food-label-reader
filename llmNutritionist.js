/**
 * llmNutritionist.js
 * Free-tier LLM analysis via Hugging Face Inference API — mirrors the
 * llm_nutritionist / _prompt_nutritionist design shown in the professor's
 * backend slides, adapted for a free HF model instead of paid OpenAI GPT-4o.
 *
 * Set HF_TOKEN in your .env file (free at https://huggingface.co/settings/tokens).
 *
 * NOTE: HuggingFace deprecated api-inference.huggingface.co in favor of
 * router.huggingface.co with an OpenAI-compatible chat completions format.
 */

const fetch = require('node-fetch');

const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

const CONDITION_LABELS = {
  diabetes: 'Diabetes',
  high_bp: 'High Blood Pressure',
  high_cholesterol: 'High Cholesterol',
  kidney_disease: 'Kidney Disease',
  heart_disease: 'Heart Disease',
  weight_management: 'Weight Management',
  pregnancy: 'Pregnancy',
  nut_allergy: 'Nut Allergy',
  dairy_intolerance: 'Dairy / Lactose Intolerance',
  gluten_celiac: 'Gluten / Celiac',
  egg_allergy: 'Egg Allergy',
};

function buildPrompt(nutritionData, dvPercent, ingredients, conditions = [], additives = {}) {
  const conditionNote = conditions.length
    ? `\n5. The user has the following health condition(s): ${conditions
        .map((c) => CONDITION_LABELS[c] || c)
        .join(', ')}. Explicitly call out any nutrients OR ingredients here that are a concern for these condition(s) — for allergy/intolerance conditions (nut, dairy, gluten, egg), carefully check the ingredients list for relevant triggers and warn clearly if found. Tailor the "Healthy Eating Tip" to these condition(s).`
    : '';

  const additiveNote = Object.keys(additives).length
    ? `\nDetected additives (already factored into the numeric health score — your write-up must be consistent with a lower score, not just mention these in passing): ${JSON.stringify(additives)}`
    : '';

  return `You are an experienced nutritionist with extensive knowledge of food science, dietary guidelines, and health optimization. Your task is to analyze the nutritional information below.

1. Determine if the food item is generally healthy or not.
2. Explain your reasoning, highlighting both positive and negative aspects of the food's nutritional profile.
3. Identify any concerning ingredients or nutritional red flags.
4. Suggest healthier alternatives or ways to balance the diet if the item is consumed.${conditionNote}

FDA %DV classification you MUST use (do not invent your own thresholds):
- ≤5% DV = "low"
- 6–19% DV = "moderate"
- ≥20% DV = "high"
Apply this per nutrient using the "% of daily value" numbers given below. Do not call a nutrient "high" unless its %DV is ≥20 — for example, sodium at 7% DV is LOW, not high.

CRITICAL — numeric accuracy:
- Every number you state (amounts, %DV, grams, mg) MUST come exactly from the JSON data below.
- Do NOT calculate, estimate, round differently, or invent any numeric value that is not already present in the data.
- If a nutrient isn't in the data, don't state a number for it — say the data wasn't available instead.

Instructions:
- Begin your response with the phrase "Nutritional Analysis:" followed by your evaluation.
- Use the JSON data to extract key information such as ingredients, macro-nutrients, and other components.
- Highlight important values like calories, sugar, sodium, saturated fat, and beneficial nutrients (fiber, vitamins, etc.), using the low/moderate/high classification above.
- If additives are listed below, you MUST mention them explicitly — do not omit them even if the macros look fine.
- Conclude with a "Healthy Eating Tip:" that provides actionable advice for maintaining a nutritious diet.
- Keep the whole response under 120 words.

Nutrition data (per serving): ${JSON.stringify(nutritionData)}
% of daily value: ${JSON.stringify(dvPercent)}
Ingredients: ${JSON.stringify(ingredients)}${additiveNote}`;
}

// --- Post-generation numeric validation -----------------------------------
// An 8B free-tier model can still ignore the "use exact numbers" instruction
// and hallucinate a plausible-looking figure (e.g. printing "1.68g" fiber
// when the parsed data says 1.4g). Rather than trust the model, we scan its
// output for "<number><unit>" mentions of the nutrients we actually parsed
// and check each one against the real value (with small rounding tolerance).
// If ANY stated number doesn't match anything we gave it, the analysis is
// unreliable and we fall back to the deterministic rule-based summary
// instead of showing the user a made-up figure.
const UNIT_BY_KEY = {
  calories: 'kcal', total_fat_g: 'g', saturated_fat_g: 'g', trans_fat_g: 'g',
  cholesterol_mg: 'mg', sodium_mg: 'mg', total_carbs_g: 'g', fiber_g: 'g',
  total_sugars_g: 'g', added_sugars_g: 'g', protein_g: 'g',
};

function extractStatedNumbers(text) {
  // Matches things like "1.68g", "100 mg", "150kcal", "7%"
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(g|mg|kcal|%)/gi)];
  return matches.map((m) => ({ value: parseFloat(m[1]), unit: m[2].toLowerCase() }));
}

function validateAnalysisNumbers(analysisText, nutritionData, dvPercent) {
  const knownValues = [];
  for (const [key, amount] of Object.entries(nutritionData || {})) {
    const unit = UNIT_BY_KEY[key];
    if (unit && typeof amount === 'number') knownValues.push({ value: amount, unit });
  }
  for (const pct of Object.values(dvPercent || {})) {
    if (typeof pct === 'number') knownValues.push({ value: pct, unit: '%' });
  }

  const stated = extractStatedNumbers(analysisText);
  const TOLERANCE = 0.05; // 5% relative tolerance for rounding differences

  for (const { value, unit } of stated) {
    const matchesSomeKnownValue = knownValues.some(
      (k) => k.unit === unit && Math.abs(k.value - value) <= Math.max(0.1, k.value * TOLERANCE),
    );
    if (!matchesSomeKnownValue) return false; // found a number we can't account for
  }
  return true;
}

async function getLLMAnalysis(nutritionData, dvPercent, ingredients, conditions = [], additives = {}) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return { error: 'No HF_TOKEN set — add one to your .env file (free at huggingface.co/settings/tokens)' };
  }
  if (!nutritionData || Object.keys(nutritionData).length === 0) {
    return { error: 'No nutrition data to analyze' };
  }

  const prompt = buildPrompt(nutritionData, dvPercent, ingredients, conditions, additives);

  try {
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: HF_MODEL,
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 220,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { error: `HF API error (${response.status}): ${errText.slice(0, 200)}` };
    }

    const result = await response.json();
    const text = (result?.choices?.[0]?.message?.content || '').trim();

    if (text && !validateAnalysisNumbers(text, nutritionData, dvPercent)) {
      return { error: 'LLM output contained a number not present in the parsed data (likely hallucinated) — discarded' };
    }

    return { analysis: text };
  } catch (err) {
    return { error: `Request failed: ${err.message}` };
  }
}

const INGREDIENT_TRIGGERS = {
  nut_allergy: ['peanut', 'almond', 'cashew', 'walnut', 'pecan', 'pistachio', 'hazelnut', 'macadamia', 'tree nut', 'nut'],
  dairy_intolerance: ['milk', 'cream', 'butter', 'cheese', 'whey', 'casein', 'lactose', 'yogurt', 'dairy'],
  gluten_celiac: ['wheat', 'barley', 'rye', 'malt', 'gluten', 'flour', 'bran', 'semolina'],
  egg_allergy: ['egg', 'albumin', 'mayonnaise'],
};

function ruleBasedFallback(dvPercent, conditions = [], ingredients = [], additives = {}) {
  const flags = [];

  const ADDITIVE_LABELS = {
    artificialColors: 'artificial color(s)',
    artificialSweeteners: 'artificial sweetener(s)',
    nitritesNitrates: 'nitrite/nitrate preservative(s)',
    otherPreservatives: 'preservative(s)',
    hydrogenatedOils: 'partially hydrogenated oil (possible hidden trans fat)',
    flavorEnhancers: 'flavor enhancer(s)',
  };
  for (const [category, hits] of Object.entries(additives)) {
    if (hits && hits.length) {
      flags.push(`⚠️ Contains ${ADDITIVE_LABELS[category] || category}: ${hits.join(', ')}.`);
    }
  }

  const highs = Object.entries(dvPercent).filter(([, pct]) => pct >= 20);
  const lows = Object.entries(dvPercent).filter(([, pct]) => pct <= 5);

  for (const [key] of highs) {
    const name = key.replace(/_g|_mg/g, '').replace(/_/g, ' ');
    flags.push(`⚠️ High ${name} content.`);
  }
  for (const [key] of lows) {
    const name = key.replace(/_g|_mg/g, '').replace(/_/g, ' ');
    if (['protein_g', 'fiber_g'].includes(key)) continue;
    flags.push(`✅ Low ${name}.`);
  }
  if ((dvPercent.protein_g || 0) >= 15) flags.push('✅ Good protein content.');

  if (conditions.includes('diabetes') && (dvPercent.total_sugars_g || 0) >= 15) {
    flags.push('🩺 Diabetes note: sugar content here may cause a notable blood sugar spike.');
  }
  if (conditions.includes('high_bp') && (dvPercent.sodium_mg || 0) >= 15) {
    flags.push('🩺 High BP note: sodium level is a concern for blood pressure management.');
  }
  if (conditions.includes('high_cholesterol') && (dvPercent.saturated_fat_g || 0) >= 15) {
    flags.push('🩺 Cholesterol note: saturated fat content may impact cholesterol levels.');
  }
  if (conditions.includes('kidney_disease') && (dvPercent.sodium_mg || 0) >= 15) {
    flags.push('🩺 Kidney note: sodium (and check for potassium/phosphorus additives) may be a concern.');
  }
  if (conditions.includes('heart_disease') && ((dvPercent.saturated_fat_g || 0) >= 15 || (dvPercent.sodium_mg || 0) >= 15)) {
    flags.push('🩺 Heart health note: saturated fat and/or sodium levels here are worth watching.');
  }
  if (conditions.includes('weight_management') && (dvPercent.calories || 0) >= 20) {
    flags.push('🩺 Weight management note: this is a calorie-dense item relative to daily needs — mind portion size.');
  }
  if (conditions.includes('pregnancy') && (dvPercent.sodium_mg || 0) >= 15) {
    flags.push('🩺 Pregnancy note: sodium level here is on the higher side — moderate intake recommended.');
  }

  const ingredientsText = (ingredients || []).join(' ').toLowerCase();
  for (const cond of ['nut_allergy', 'dairy_intolerance', 'gluten_celiac', 'egg_allergy']) {
    if (!conditions.includes(cond)) continue;
    const triggers = INGREDIENT_TRIGGERS[cond];
    const found = triggers.filter((t) => ingredientsText.includes(t));
    if (found.length) {
      flags.push(`🚨 ${CONDITION_LABELS[cond]} alert: ingredients list mentions "${found.join('", "')}" — check carefully.`);
    } else if (ingredientsText) {
      flags.push(`✅ ${CONDITION_LABELS[cond]}: no obvious trigger ingredients detected, but always verify the physical label.`);
    }
  }

  if (flags.length === 0) flags.push('ℹ️ Nutrition values are within moderate range.');
  return flags.join(' ');
}

module.exports = { getLLMAnalysis, ruleBasedFallback };
