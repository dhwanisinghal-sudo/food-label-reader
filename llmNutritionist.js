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

// Free instruction-tuned model on HF Inference API. Swap for another
// hosted model if this one is unavailable/rate-limited on your token.
const HF_MODEL = 'Qwen/Qwen2.5-7B-Instruct:fastest';
const HF_API_URL = 'https://router.huggingface.co/v1/chat/completions';

function buildPrompt(nutritionData, dvPercent, ingredients) {
  return `You are an experienced nutritionist with extensive knowledge of food science, dietary guidelines, and health optimization. Your task is to analyze the nutritional information below.

1. Determine if the food item is generally healthy or not.
2. Explain your reasoning, highlighting both positive and negative aspects of the food's nutritional profile.
3. Identify any concerning ingredients or nutritional red flags.
4. Suggest healthier alternatives or ways to balance the diet if the item is consumed.

Instructions:
- Begin your response with the phrase "Nutritional Analysis:" followed by your evaluation.
- Use the JSON data to extract key information such as ingredients, macro-nutrients, and other components.
- Highlight important values like calories, sugar, sodium, saturated fat, and beneficial nutrients (fiber, vitamins, etc.).
- Conclude with a "Healthy Eating Tip:" that provides actionable advice for maintaining a nutritious diet.
- Keep the whole response under 120 words.

Nutrition data (per serving): ${JSON.stringify(nutritionData)}
% of daily value: ${JSON.stringify(dvPercent)}
Ingredients: ${JSON.stringify(ingredients)}`;
}

async function getLLMAnalysis(nutritionData, dvPercent, ingredients) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return { error: 'No HF_TOKEN set — add one to your .env file (free at huggingface.co/settings/tokens)' };
  }
  if (!nutritionData || Object.keys(nutritionData).length === 0) {
    return { error: 'No nutrition data to analyze' };
  }

  const prompt = buildPrompt(nutritionData, dvPercent, ingredients);

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

// Lightweight rule-based fallback (used if no HF_TOKEN, or the API call
// fails/rate-limits) so the endpoint still returns something useful.
function ruleBasedFallback(dvPercent) {
  const flags = [];
  const highs = Object.entries(dvPercent).filter(([, pct]) => pct >= 40);
  const lows = Object.entries(dvPercent).filter(([, pct]) => pct <= 5);

  for (const [key] of highs) {
    const name = key.replace(/_g|_mg/g, '').replace(/_/g, ' ');
    flags.push(`⚠️ High ${name} content.`);
  }
  for (const [key] of lows) {
    const name = key.replace(/_g|_mg/g, '').replace(/_/g, ' ');
    if (['protein_g', 'fiber_g'].includes(key)) continue; // low protein/fiber isn't a "good" flag
    flags.push(`✅ Low ${name}.`);
  }
  if ((dvPercent.protein_g || 0) >= 15) flags.push('✅ Good protein content.');
  if (flags.length === 0) flags.push('ℹ️ Nutrition values are within moderate range.');
  return flags.join(' ');
}

module.exports = { getLLMAnalysis, ruleBasedFallback };
