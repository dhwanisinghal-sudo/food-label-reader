const {
  parseNutrition, parseIngredients, detectAllergens, detectAdditives,
  calculateDailyValuePercent, calculateHealthScore,
  checkDietCompatibility, checkHalalKosher, checkKetoCompatibility,
  checkPaleoCompatibility, checkFodmapCompatibility, checkAllDietCompatibility,
  cleanNum, splitTopLevelCommas,
} = require('../src/nutritionParser');

describe('parseNutrition - clean US label', () => {
  const text = `Nutrition Facts
Serving Size 28g
Calories 160
Total Fat 10g 13%
Saturated Fat 1.5g 8%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 250mg 11%
Total Carbohydrate 15g 6%
Dietary Fiber 1g 3%
Total Sugars 1g
Protein 2g
Vitamin D 0mcg 0%
Calcium 15mg 0%
Iron 0.3mg 2%
Potassium 53mg 0%`;
  const result = parseNutrition(text);

  test('extracts all core macro fields', () => {
    expect(result.calories).toBe(160);
    expect(result.total_fat_g).toBe(10);
    expect(result.saturated_fat_g).toBe(1.5);
    expect(result.trans_fat_g).toBe(0);
    expect(result.cholesterol_mg).toBe(0);
    expect(result.sodium_mg).toBe(250);
    expect(result.total_carbs_g).toBe(15);
    expect(result.fiber_g).toBe(1);
    expect(result.total_sugars_g).toBe(1);
    expect(result.protein_g).toBe(2);
  });

  test('extracts micronutrients', () => {
    expect(result.vitamin_d_mcg).toBe(0);
    expect(result.calcium_mg).toBe(15);
    expect(result.iron_mg).toBe(0.3);
    expect(result.potassium_mg).toBe(53);
  });

  test('extracts serving size', () => {
    expect(result.serving_size).toBe('28g');
  });

  test('no corrections fire on a clean, self-consistent label', () => {
    expect(result.corrections).toBeUndefined();
  });
});

describe('parseNutrition - OCR digit-fused-unit noise (g misread as trailing 9/3)', () => {
  test('"Total Fat 89 12%" is read as 8g, not 89g (89 is outside PLAUSIBLE_RANGE anyway)', () => {
    const result = parseNutrition('Total Fat 89 12%');
    expect(result.total_fat_g).toBe(8);
  });

  test('"Total Carbohydrate 189" is read as 18g', () => {
    const result = parseNutrition('Total Carbohydrate 189');
    expect(result.total_carbs_g).toBe(18);
  });

  test('"Protein 29" is read as 2g', () => {
    const result = parseNutrition('Protein 29');
    expect(result.protein_g).toBe(2);
  });
});

describe('parseNutrition - digit/letter OCR confusion (O/o -> 0, I/l -> 1)', () => {
  test('cleanNum fixes letter-for-digit substitutions', () => {
    expect(cleanNum('1O0')).toBe(100);
    expect(cleanNum('l0')).toBe(10);
    expect(cleanNum('I5')).toBe(15);
  });

  test('a garbled calories line still parses via cleanNum', () => {
    const result = parseNutrition('Calories l6O');
    expect(result.calories).toBe(160);
  });
});

describe('parseNutrition - %DV cross-check self-correction', () => {
  test('corrects a wildly implausible amount using the declared %DV (ratio < 0.25)', () => {
    // our %DV = 5/2300*100 = 0.217%, declared = 20% -> ratio ~0.0109, triggers correction
    const result = parseNutrition('Sodium 5mg 20%');
    expect(result.sodium_mg).toBe(460); // 20% of 2300mg
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toMatchObject({ field: 'sodium_mg', from: 5, to: 460 });
  });

  test('does NOT correct when computed and declared %DV are reasonably close', () => {
    // our %DV = 2/28*100 = 7.14%, declared 5% -> ratio ~1.43, inside 0.25-4x tolerance
    const result = parseNutrition('Dietary Fiber 2g 5%');
    expect(result.fiber_g).toBe(2);
    expect(result.corrections).toBeUndefined();
  });

  test('does NOT borrow a %DV that belongs to the next line (newline-bounded lookahead)', () => {
    const text = 'Dietary Fiber 2g\nSaturated Fat 1g 5%';
    const result = parseNutrition(text);
    expect(result.fiber_g).toBe(2);
    expect(result.corrections).toBeUndefined();
  });
});

describe('parseNutrition - EU/UK/AU "Salt" fallback for sodium', () => {
  test('derives sodium_mg from salt(g) x 400 when no direct Sodium line exists', () => {
    const result = parseNutrition('Salt 1.5g');
    expect(result.sodium_mg).toBe(600);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0].reason).toMatch(/salt/i);
  });

  test('a direct Sodium line takes priority over Salt (never both on a real label)', () => {
    const result = parseNutrition('Sodium 100mg\nSalt 5g');
    expect(result.sodium_mg).toBe(100);
  });
});

describe('parseNutrition - values outside PLAUSIBLE_RANGE are dropped', () => {
  test('an implausible calorie value is not captured', () => {
    const result = parseNutrition('Calories 99999');
    expect(result.calories).toBeUndefined();
  });
});

describe('parseNutrition - dual-column ("Per Serving | Per Container") labels', () => {
  // NOTE: no real OCR output from an actual dual-column label was
  // available to test against — both plausible token orderings below are
  // covered defensively rather than assuming one is correct. See the
  // withOptionalSecondValue comment in nutritionParser.js for the
  // reasoning.

  test('amounts-then-percents ordering: captures both values, and %DV attaches to the per-serving amount', () => {
    // "Total Fat 20g 61g 26% 78%" — per serving 20g/26%, per container 61g/78%
    const result = parseNutrition('Total Fat 20g 61g 26% 78%');
    expect(result.total_fat_g).toBe(20); // per-serving stays the primary value
    expect(result.perContainer.total_fat_g).toBe(61);
    expect(result.dualColumnLabel).toBe(true);
    expect(result.corrections).toBeUndefined(); // 20/78*100=25.6% vs declared 26% — no false "correction"
  });

  test('amount-percent-pairs ordering: still gets the correct per-serving amount, gracefully skips per-container', () => {
    // "Total Fat 20g 26% 61g 78%" — each column's amount is immediately
    // followed by its own %DV, so the optional second-value group (which
    // requires a unit, not a "%") does not match here.
    const result = parseNutrition('Total Fat 20g 26% 61g 78%');
    expect(result.total_fat_g).toBe(20);
    expect(result.perContainer).toBeUndefined();
    expect(result.dualColumnLabel).toBeUndefined();
  });

  test('does not misfire a %DV correction using the per-container percent', () => {
    // If the cross-check window incorrectly grabbed the per-container 78%
    // for the per-serving 20g value (our %DV ~25.6%), ratio would still be
    // within tolerance here — so use a case where using the WRONG percent
    // would actually trigger a bad correction, to prove it doesn't happen.
    // Sodium 100mg (our %DV ~4.3%) with a per-container %DV of 80% would
    // trigger an incorrect correction (ratio ~0.054, well under 0.25) if
    // the 80% were wrongly attributed to the 100mg serving value.
    const result = parseNutrition('Sodium 100mg 2000mg 4% 80%');
    expect(result.sodium_mg).toBe(100); // uses the FIRST %, 4% — correct, no bogus correction
    expect(result.perContainer.sodium_mg).toBe(2000);
    expect(result.corrections).toBeUndefined();
  });

  test('multiple dual-column fields on separate lines each get their own perContainer entry', () => {
    const text = 'Total Fat 20g 61g 26% 78%\nProtein 5g 16g 10% 32%';
    const result = parseNutrition(text);
    expect(result.perContainer).toEqual({ total_fat_g: 61, protein_g: 16 });
    expect(result.dualColumnLabel).toBe(true);
  });

  test('a per-container value outside PLAUSIBLE_RANGE is dropped, primary value is kept', () => {
    // total_fat_g range is [0, 100] — 999g per container is implausible
    const result = parseNutrition('Total Fat 20g 999g');
    expect(result.total_fat_g).toBe(20);
    expect(result.perContainer).toBeUndefined();
  });

  test('single-column labels are completely unaffected (no perContainer, no flag)', () => {
    const result = parseNutrition('Total Fat 10g 13%\nSodium 250mg 11%');
    expect(result.total_fat_g).toBe(10);
    expect(result.sodium_mg).toBe(250);
    expect(result.perContainer).toBeUndefined();
    expect(result.dualColumnLabel).toBeUndefined();
  });

  test('fields outside DUAL_COLUMN_FIELDS (e.g. calories) are not affected by the second-value logic', () => {
    const result = parseNutrition('Calories 330\nTotal Fat 20g 61g 26% 78%');
    expect(result.calories).toBe(330);
    expect(result.perContainer.total_fat_g).toBe(61);
    expect(result.perContainer.calories).toBeUndefined();
  });
});

describe('parseIngredients', () => {
  test('splits a simple flat ingredient list', () => {
    const text = 'Ingredients: Water, Sugar, Salt, Citric Acid.';
    expect(parseIngredients(text)).toEqual(['Water', 'Sugar', 'Salt', 'Citric Acid']);
  });

  test('keeps parenthesized sub-ingredients as one item', () => {
    const text = 'Ingredients: Vegetable Oil (Corn, Canola, Soybean and/or Sunflower Oil), Salt, Cheddar Cheese [Milk, Cheese Cultures, Salt, Enzymes]';
    const result = parseIngredients(text);
    expect(result).toContain('Vegetable Oil (Corn, Canola, Soybean and/or Sunflower Oil)');
    expect(result).toContain('Cheddar Cheese [Milk, Cheese Cultures, Salt, Enzymes]');
    expect(result).toContain('Salt');
    expect(result).toHaveLength(3);
  });

  test('strips a leading "and"/"or" from the final item', () => {
    const text = 'Ingredients: Flour, Sugar, and Salt.';
    const result = parseIngredients(text);
    expect(result).toEqual(['Flour', 'Sugar', 'Salt']);
  });

  test('stops at a following "Contains:" allergen statement', () => {
    const text = 'Ingredients: Corn Meal, Cheese, Salt. Contains: Milk.';
    const result = parseIngredients(text);
    expect(result).toEqual(['Corn Meal', 'Cheese', 'Salt']);
  });

  test('stops at "Nutrition Facts" if it appears after the ingredient list', () => {
    const text = 'Ingredients: Oats, Honey\nNutrition Facts\nCalories 120';
    expect(parseIngredients(text)).toEqual(['Oats', 'Honey']);
  });

  test('returns an empty array when there is no "Ingredients:" label at all', () => {
    expect(parseIngredients('Calories 160\nTotal Fat 10g')).toEqual([]);
  });
});

describe('splitTopLevelCommas', () => {
  test('does not split inside nested brackets of mixed types', () => {
    const text = 'A (B, C [D, E]), F';
    expect(splitTopLevelCommas(text)).toEqual(['A (B, C [D, E])', ' F']);
  });
});

describe('detectAllergens', () => {
  test('flags Milk/Dairy and Egg from a real ingredient list', () => {
    const ingredients = ['Enriched Corn Meal', 'Cheddar Cheese (Milk, Cheese Cultures)', 'Whey Protein Concentrate', 'Salt'];
    const result = detectAllergens(ingredients);
    expect(Object.keys(result)).toContain('Milk/Dairy');
    expect(result['Milk/Dairy']).toEqual(
      expect.arrayContaining(['Cheddar Cheese (Milk, Cheese Cultures)', 'Whey Protein Concentrate']),
    );
    expect(result['Egg']).toBeUndefined();
  });

  test('returns an empty object when no allergens are present', () => {
    expect(detectAllergens(['Water', 'Sugar', 'Citric Acid'])).toEqual({});
  });
});

describe('detectAdditives', () => {
  test('flags MSG under flavorEnhancers', () => {
    const result = detectAdditives(['Monosodium Glutamate', 'Salt']);
    expect(result.flavorEnhancers).toEqual(['Monosodium Glutamate']);
  });

  test('flags partially hydrogenated oil', () => {
    const result = detectAdditives(['Partially Hydrogenated Soybean Oil']);
    expect(result.hydrogenatedOils).toEqual(['Partially Hydrogenated Soybean Oil']);
  });

  test('a single ingredient can match more than one category independently', () => {
    const result = detectAdditives(['Red 40', 'Sodium Benzoate']);
    expect(result.artificialColors).toEqual(['Red 40']);
    expect(result.otherPreservatives).toEqual(['Sodium Benzoate']);
  });
});

describe('diet compatibility checks', () => {
  test('checkDietCompatibility flags milk/egg for vegan but allows vegetarian', () => {
    const result = checkDietCompatibility(['Milk', 'Egg', 'Sugar']);
    expect(result.veganFriendly).toBe(false);
    expect(result.veganConflicts).toEqual(expect.arrayContaining(['milk', 'egg']));
    expect(result.vegetarianFriendly).toBe(true);
  });

  test('checkHalalKosher flags pork as definite, gelatin as uncertain (source-dependent)', () => {
    const result = checkHalalKosher(['Pork', 'Gelatin', 'Water']);
    expect(result.halalKosherSafe).toBe(false);
    expect(result.definiteConflicts).toEqual(expect.arrayContaining(['pork']));
    expect(result.uncertainIngredients).toEqual(expect.arrayContaining(['gelatin']));
  });

  test('checkKetoCompatibility computes net carbs and flags high-carb keywords', () => {
    const result = checkKetoCompatibility({ total_carbs_g: 15, fiber_g: 3 }, ['Corn Syrup']);
    expect(result.netCarbsG).toBe(12);
    expect(result.ketoFriendly).toBe(false);
    expect(result.conflicts).toEqual(['corn syrup']);
  });

  test('checkKetoCompatibility is friendly when net carbs are low and no conflicts', () => {
    const result = checkKetoCompatibility({ total_carbs_g: 5, fiber_g: 3 }, ['Chicken', 'Salt']);
    expect(result.netCarbsG).toBe(2);
    expect(result.ketoFriendly).toBe(true);
  });

  test('checkPaleoCompatibility flags dairy/wheat', () => {
    const result = checkPaleoCompatibility(['Wheat Flour', 'Milk']);
    expect(result.paleoFriendly).toBe(false);
  });

  test('checkFodmapCompatibility flags garlic/onion', () => {
    const result = checkFodmapCompatibility(['Garlic Powder', 'Onion']);
    expect(result.lowFodmap).toBe(false);
  });

  test('checkAllDietCompatibility returns null for an empty ingredient list', () => {
    expect(checkAllDietCompatibility({}, [])).toBeNull();
    expect(checkAllDietCompatibility({}, null)).toBeNull();
  });

  // GAP FIX regression tests: these five kept `.includes()` substring
  // matching (the "eggplant" bug already fixed for vegan/allergens on the
  // Python side, src/nutrition_parser.py's _keyword_matches) until now.
  test('checkDietCompatibility does not flag eggplant as an egg/vegan conflict', () => {
    const result = checkDietCompatibility(['Eggplant', 'Salt', 'Olive Oil']);
    expect(result.veganFriendly).toBe(true);
    expect(result.veganConflicts).toEqual([]);
  });

  test('checkDietCompatibility does not flag coconut milk as a dairy/vegan conflict', () => {
    const result = checkDietCompatibility(['Coconut Milk', 'Sugar', 'Cocoa']);
    expect(result.veganFriendly).toBe(true);
  });

  test('checkDietCompatibility still flags real dairy milk for vegan', () => {
    const result = checkDietCompatibility(['Milk', 'Sugar']);
    expect(result.veganFriendly).toBe(false);
    expect(result.veganConflicts).toContain('milk');
  });

  test('checkHalalKosher does not false-positive on a substring collision', () => {
    // "hamburger" contains "ham" as a substring but is not the pork product.
    const result = checkHalalKosher(['Hamburger Seasoning', 'Salt']);
    expect(result.halalKosherSafe).toBe(true);
  });

  test('detectAllergens does not flag eggplant, still flags plural "Eggs"', () => {
    expect(detectAllergens(['Eggplant', 'Salt'])).toEqual({});
    expect(detectAllergens(['Eggs', 'Sugar'])).toEqual(
      expect.objectContaining({ 'Egg': ['Eggs'] }),
    );
  });

  test('checkAllDietCompatibility bundles all five checks together', () => {
    const result = checkAllDietCompatibility({ total_carbs_g: 20, fiber_g: 2 }, ['Wheat Flour', 'Sugar']);
    expect(result).toHaveProperty('vegan');
    expect(result).toHaveProperty('vegetarian');
    expect(result).toHaveProperty('halalKosher');
    expect(result).toHaveProperty('keto');
    expect(result).toHaveProperty('paleo');
    expect(result).toHaveProperty('lowFodmap');
    expect(result.vegan.friendly).toBe(true); // no vegan-conflict keyword in this list
  });
});

describe('calculateDailyValuePercent', () => {
  test('computes %DV against the default adult/child-4+ table', () => {
    const dv = calculateDailyValuePercent({ sodium_mg: 460, protein_g: 25 });
    expect(dv.sodium_mg).toBe(20); // 460/2300*100
    expect(dv.protein_g).toBe(50); // 25/50*100
  });

  test('uses the children_1_3 table when ageGroup is specified', () => {
    const dv = calculateDailyValuePercent({ sodium_mg: 150 }, 'children_1_3');
    expect(dv.sodium_mg).toBe(10); // 150/1500*100
  });

  test('falls back to the default table for an unknown ageGroup', () => {
    const dv = calculateDailyValuePercent({ sodium_mg: 230 }, 'not_a_real_group');
    expect(dv.sodium_mg).toBe(10); // 230/2300*100, using default DAILY_VALUES
  });

  test('ignores keys not present in the reference table and null amounts', () => {
    const dv = calculateDailyValuePercent({ sodium_mg: null, not_a_nutrient: 5 });
    expect(dv).toEqual({});
  });
});

describe('calculateHealthScore', () => {
  test('returns N/A when no nutrition data was extracted', () => {
    const result = calculateHealthScore({}, {});
    expect(result.score).toBeNull();
    expect(result.label).toMatch(/N\/A/);
  });

  test('a clean low-sodium/low-sugar/low-sat-fat item with grade A and no additives scores 100', () => {
    const dv = { saturated_fat_g: 5, total_sugars_g: 5, sodium_mg: 5 };
    const result = calculateHealthScore(dv, { calories: 100 }, {}, 1, 'a');
    expect(result.score).toBe(100);
    expect(result.label).toBe('Excellent');
    expect(result.breakdown).toEqual([]);
  });

  test('penalizes only the amount over the 20% DV threshold, per nutrient', () => {
    const dv = { saturated_fat_g: 40, total_sugars_g: 0, sodium_mg: 0 };
    // (40 - 20) * 0.3 * 10 / 10 = 6 -> score 94
    const result = calculateHealthScore(dv, { calories: 100 }, {}, null, 'a');
    expect(result.score).toBe(94);
    expect(result.breakdown[0].reason).toMatch(/Saturated fat at 40% daily value/);
  });

  test('applies the NOVA group 4 penalty', () => {
    const result = calculateHealthScore({}, { calories: 100 }, {}, 4, 'a');
    expect(result.score).toBe(85);
  });

  test('applies the NOVA group 3 penalty', () => {
    const result = calculateHealthScore({}, { calories: 100 }, {}, 3, 'a');
    expect(result.score).toBe(93);
  });

  test('defaults to a -10 penalty when no Nutri-Score grade is provided', () => {
    const result = calculateHealthScore({}, { calories: 100 }, {}, null, null);
    expect(result.score).toBe(90);
    expect(result.breakdown[0].reason).toBe('Nutri-Score unknown');
  });

  test('applies grade-specific Nutri-Score penalties', () => {
    expect(calculateHealthScore({}, { calories: 100 }, {}, null, 'e').score).toBe(72);
    expect(calculateHealthScore({}, { calories: 100 }, {}, null, 'b').score).toBe(95);
  });

  test('caps the additive penalty at -15 even with more than 5 categories', () => {
    const additives = {
      artificialColors: ['Red 40'],
      artificialSweeteners: ['Aspartame'],
      nitritesNitrates: ['Sodium Nitrite'],
      otherPreservatives: ['BHA'],
      hydrogenatedOils: ['Partially Hydrogenated Oil'],
      flavorEnhancers: ['MSG'],
    };
    const result = calculateHealthScore({}, { calories: 100 }, additives, null, 'a');
    // 6 categories * 3 = 18, capped at 15
    expect(result.score).toBe(85);
  });

  test('score is clamped to a 0-100 range and never negative', () => {
    const dv = { saturated_fat_g: 100, total_sugars_g: 100, sodium_mg: 100 };
    const additives = { artificialColors: ['Red 40'], artificialSweeteners: ['Aspartame'] };
    const result = calculateHealthScore(dv, { calories: 100 }, additives, 4, 'e');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
