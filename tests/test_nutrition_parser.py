"""
Unit tests for the nutrition parsing logic.
Run with: pytest test_nutrition_parser.py -v

FIXED from the original tests/Test nutrition parser.py, which:
  1. Had a space in the filename (pytest can still collect this, but it's
     non-standard and some tools choke on it) -> renamed to
     test_nutrition_parser.py
  2. Imported `from app import ...`, but no app.py exists anywhere in the
     repo -> ModuleNotFoundError on collection, so this file never actually
     ran. Fixed to import from nutrition_parser.py instead.
  3. calculate_health_score() is called in two tests without the
     `nutrition_data` argument. The real function returns
     {'score': None, 'label': 'N/A...'} whenever nutrition_data is falsy
     (it's a guard against scoring a photo where nothing was extracted at
     all) -- so both tests would have failed once the import was fixed,
     even though the underlying scoring logic is fine. Fixed the calls to
     pass nutrition_data.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# nutrition_parser.py lives in src/, this test file lives in tests/ -- add the
# sibling src/ folder too so this runs no matter which folder you invoke it from.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))
from nutrition_parser import (
    parse_nutrition, parse_ingredients, detect_allergens,
    calculate_daily_value_percent, calculate_health_score, _clean_num,
    check_diet_compatibility,
)


class TestParseNutrition:
    def test_clean_label_extracts_all_fields(self):
        text = """
        Calories 160
        Total Fat 8g
        Saturated Fat 2g
        Cholesterol 0mg
        Sodium 110mg
        Total Carbohydrate 22g
        Dietary Fiber 1g
        Sugars 11g
        """
        result = parse_nutrition(text)
        assert result['calories'] == 160
        assert result['total_fat_g'] == 8.0
        assert result['sodium_mg'] == 110.0
        assert result['total_carbs_g'] == 22.0

    def test_ocr_zero_letter_o_confusion(self):
        # OCR often reads "0g" as "Og" (digit zero -> letter O)
        text = "Saturated Fat Og 1%\nCholesterol Omg 0%"
        result = parse_nutrition(text)
        assert result['saturated_fat_g'] == 0.0
        assert result['cholesterol_mg'] == 0.0

    def test_sugars_without_total_prefix(self):
        # Real labels often just say "Sugars 6g", not "Total Sugars 6g"
        text = "Sugars 6g"
        result = parse_nutrition(text)
        assert result['total_sugars_g'] == 6.0

    def test_percent_dv_crosscheck_corrects_misread_amount(self):
        # OCR misread "1g" as "19" for fiber, but the printed "5%" DV is correct.
        # 5% of 28g daily fiber value = 1.4g, which should override the bad "19".
        text = "Dietary Fiber 19 5%"
        result = parse_nutrition(text)
        assert result['fiber_g'] == 1.4

    def test_implausible_value_is_dropped(self):
        # A garbled OCR read with no plausible unit match should not appear at all
        text = "Total Fat 999999g"
        result = parse_nutrition(text)
        assert 'total_fat_g' not in result

    def test_empty_text_returns_empty_dict(self):
        assert parse_nutrition("") == {}

    def test_serving_size_extracted(self):
        text = "Serving Size 3 cookies (33g)"
        result = parse_nutrition(text)
        assert result['serving_size'] == '3 cookies (33g)'

    # --- New regression tests for gaps identified during the accuracy review ---

    def test_missing_sugar_is_absent_not_zero(self):
        """Documents a known limitation: if sugar isn't found, the key is
        simply absent from the dict (not set to 0). Callers (like the health
        scorer) must NOT assume a missing key means 0g -- see
        calculate_health_score, which currently does exactly that via
        dv_percent.get(key, 0). This test exists so that if someone "fixes"
        parse_nutrition to silently default to 0, it fails loudly here."""
        text = "Calories 200\nTotal Fat 5g"
        result = parse_nutrition(text)
        assert 'total_sugars_g' not in result

    def test_wrong_unit_is_not_converted(self):
        """Documents a known limitation: sodium given in grams instead of mg
        is not recognized or converted, because the regex requires an mg/mga
        suffix. This should start failing (in a good way) once unit
        conversion is implemented."""
        text = "Sodium 0.4g"
        result = parse_nutrition(text)
        assert 'sodium_mg' not in result


class TestParseIngredients:
    def test_basic_comma_separated_list(self):
        text = "Ingredients: Sugar, Flour, Salt, Cocoa"
        result = parse_ingredients(text)
        assert result == ['Sugar', 'Flour', 'Salt', 'Cocoa']

    def test_stops_at_nutrition_facts_panel(self):
        text = "Ingredients: Sugar, Flour, Salt\n\nNutrition Facts\nServing Size 1 cup\nCalories 200"
        result = parse_ingredients(text)
        assert 'Nutrition Facts' not in ' '.join(result)
        assert 'Calories 200' not in ' '.join(result)

    def test_line_wrapped_ingredient_is_preserved(self):
        text = "Ingredients: Sour Cream [Cultured Cream,\nSkim\nMilk], Sugar"
        result = parse_ingredients(text)
        assert any('Skim Milk' in item for item in result)


class TestDetectAllergens:
    def test_milk_detected(self):
        result = detect_allergens(['Whey', 'Skim Milk', 'Sugar'])
        assert 'Milk/Dairy' in result

    def test_no_allergens_in_clean_list(self):
        result = detect_allergens(['Water', 'Salt', 'Citric Acid'])
        assert result == {}

    def test_eggplant_false_positive_is_fixed(self):
        """This used to be a documented BUG (substring 'egg' matched inside
        'eggplant'). Fixed with word-boundary matching -- now correctly
        does NOT flag Egg."""
        result = detect_allergens(['Eggplant', 'Olive Oil', 'Salt'])
        assert 'Egg' not in result

    def test_real_egg_still_detected(self):
        # regression guard: fixing the eggplant false-positive must not
        # break detection of an ingredient that is actually egg
        result = detect_allergens(['Egg Whites', 'Sugar'])
        assert 'Egg' in result

    def test_coconut_milk_is_not_flagged_as_dairy(self):
        """Fixed: 'milk' inside the known plant-milk phrase 'coconut milk'
        no longer triggers a Milk/Dairy allergen flag."""
        result = detect_allergens(['Coconut Milk', 'Sugar', 'Salt'])
        assert 'Milk/Dairy' not in result

    def test_real_dairy_milk_still_detected(self):
        result = detect_allergens(['Whole Milk', 'Sugar'])
        assert 'Milk/Dairy' in result


class TestDietCompatibility:
    def test_eggplant_is_vegan_friendly(self):
        result = check_diet_compatibility(['Eggplant', 'Tomato', 'Olive Oil', 'Garlic', 'Salt'])
        assert result['vegan_friendly'] is True

    def test_coconut_milk_is_vegan_friendly(self):
        result = check_diet_compatibility(['Coconut Milk', 'Sugar', 'Cocoa'])
        assert result['vegan_friendly'] is True

    def test_real_milk_is_not_vegan_friendly(self):
        result = check_diet_compatibility(['Whole Milk', 'Sugar'])
        assert result['vegan_friendly'] is False
        assert 'milk' in result['vegan_conflicts']


class TestHealthScore:
    def test_no_data_returns_na(self):
        result = calculate_health_score({}, nutrition_data=None)
        assert result['score'] is None
        assert 'N/A' in result['label']

    def test_low_sugar_sodium_scores_high(self):
        dv = {'total_sugars_g': 4.0, 'sodium_mg': 5.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] >= 80

    def test_high_sugar_sodium_scores_lower(self):
        dv = {'total_sugars_g': 90.0, 'sodium_mg': 80.0, 'saturated_fat_g': 70.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 500, 'trans_fat_g': 0})
        assert result['score'] < 80

    def test_missing_field_is_flagged_not_silently_zeroed(self):
        """Fixed: a missing sugar reading now produces a warning instead of
        being silently treated as a confirmed 0g."""
        dv_missing_sugar = {'sodium_mg': 5.0, 'saturated_fat_g': 0.0}  # no total_sugars_g key
        result = calculate_health_score(dv_missing_sugar, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert any('sugar' in w for w in result['warnings'])

    def test_trans_fat_now_penalized(self):
        """Fixed: trans fat used to contribute nothing to the score at all.
        This is the real photographed example from the accuracy review
        (unidentified_yellow_box_product_jpg.jpg): 3g trans fat/serving."""
        dv = {'total_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        clean_result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        trans_fat_result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 3})
        assert trans_fat_result['score'] < clean_result['score']

    def test_no_barcode_match_no_longer_auto_penalized(self):
        """Fixed: previously EVERY product without an OpenFoodFacts match
        ate a flat -10 penalty regardless of its own label. Now, no lookup
        at all (nutriscore_grade=None) means no penalty either way."""
        dv = {'total_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutriscore_grade=None, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] == 100

    def test_genuinely_unknown_grade_after_lookup_still_penalized(self):
        dv = {'total_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutriscore_grade='unknown', nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] == 90


class TestCleanNum:
    def test_letter_o_to_zero(self):
        assert _clean_num('O') == 0.0

    def test_normal_number(self):
        assert _clean_num('12.5') == 12.5

    def test_garbage_returns_none(self):
        assert _clean_num('abc') is None


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
