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

Instructions:
- Begin your response with the phrase "Nutritional Analysis:" followed by your evaluation.
- Use the JSON data to extract key information such as ingredients, macro-nutrients, and other components.
- Highlight important values like calories, sugar, sodium, saturated fat, and beneficial nutrients (fiber, vitamins, etc.).
- If additives are listed below, you MUST mention them explicitly — do not omit them even if the macros look fine.
- Conclude with a "Healthy Eating Tip:" that provides actionable advice for maintaining a nutritious diet.
- Keep the whole response under 120 words.

Nutrition data (per serving): ${JSON.stringify(nutritionData)}
% of daily value: ${JSON.stringify(dvPercent)}
Ingredients: ${JSON.stringify(ingredients)}${additiveNote}`;
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
    const text = result?.choices?.[0]?.message?.content;
    return { analysis: (text || '').trim() };
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

  const highs = Object.entries(dvPercent).filter(([, pct]) => pct >= 40);
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
