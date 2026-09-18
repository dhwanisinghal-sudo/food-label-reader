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
from nutrition_parser import (
    parse_nutrition, parse_ingredients, detect_allergens,
    calculate_daily_value_percent, calculate_health_score, _clean_num,
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

    def test_false_positive_eggplant(self):
        """Known bug found during the accuracy review: substring matching
        means 'Eggplant' triggers an Egg allergen flag because 'egg' is a
        substring of 'eggplant'. This test documents the CURRENT (buggy)
        behavior. Once word-boundary matching is added, flip this
        assertion."""
        result = detect_allergens(['Eggplant', 'Olive Oil', 'Salt'])
        assert 'Egg' in result  # documents the bug; should be absent once fixed


class TestHealthScore:
    def test_no_data_returns_na(self):
        result = calculate_health_score({}, nutrition_data=None)
        assert result['score'] is None
        assert 'N/A' in result['label']

    def test_low_sugar_sodium_scores_high(self):
        dv = {'total_sugars_g': 4.0, 'sodium_mg': 5.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 100})
        assert result['score'] >= 80

    def test_high_sugar_sodium_scores_lower(self):
        dv = {'total_sugars_g': 90.0, 'sodium_mg': 80.0, 'saturated_fat_g': 70.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 500})
        assert result['score'] < 80

    def test_missing_field_silently_treated_as_zero(self):
        """Known issue found during the accuracy review: if sugar wasn't
        extracted at all, dv_percent.get('total_sugars_g', 0) treats it as
        0g sugar for scoring purposes, which can inflate the health score
        for a product where OCR simply failed to read the sugar line.

        Score here is 90, not 100: calculate_health_score always applies a
        default -10 "no Nutri-Score grade" penalty when nutriscore_grade
        isn't passed (grade_penalty.get('n/a', 10)) -- a SEPARATE bug (see
        Q12 in the accuracy review: any product without a barcode/OFF match
        loses 10 points regardless of how healthy it actually is). What
        this test actually proves is narrower: sugar contributes ZERO
        penalty when missing, exactly as if it were confirmed to be 0g.
        Compare to test_high_sugar_sodium_scores_lower, where real sugar
        data drags the score down hard -- a missing value should trigger a
        warning, not silently behave like the best possible case."""
        dv_missing_sugar = {'sodium_mg': 5.0, 'saturated_fat_g': 0.0}  # no total_sugars_g key at all
        dv_zero_sugar = {'sodium_mg': 5.0, 'saturated_fat_g': 0.0, 'total_sugars_g': 0.0}  # confirmed 0g
        missing_result = calculate_health_score(dv_missing_sugar, nutrition_data={'calories': 100})
        zero_result = calculate_health_score(dv_zero_sugar, nutrition_data={'calories': 100})
        # "sugar not found" and "sugar confirmed to be 0g" currently score identically
        assert missing_result['score'] == zero_result['score'] == 90


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
