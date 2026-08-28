"""
Unit tests for the nutrition parsing logic.
Run with: pytest test_nutrition_parser.py -v
"""

import re
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from app import (
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


class TestHealthScore:
    def test_no_data_returns_na(self):
        result = calculate_health_score({}, {})
        assert result['score'] is None
        assert 'N/A' in result['label']

    def test_low_sugar_sodium_scores_high(self):
        dv = {'total_sugars_g': 4.0, 'sodium_mg': 5.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, {'calories': 100})
        assert result['score'] >= 80

    def test_high_sugar_sodium_scores_lower(self):
        dv = {'total_sugars_g': 90.0, 'sodium_mg': 80.0, 'saturated_fat_g': 70.0}
        result = calculate_health_score(dv, {'calories': 500})
        assert result['score'] < 80


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
