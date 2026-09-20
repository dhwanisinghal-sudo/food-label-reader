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
import nutrition_parser as npm
from nutrition_parser import (
    parse_nutrition, parse_ingredients, detect_allergens,
    calculate_daily_value_percent, calculate_health_score, _clean_num,
    check_diet_compatibility,
    detect_serving_column_index, extract_text_best_effort,
    extract_text_with_confidence, _choose_serving_column,
    calculate_fsa_npm_score,
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

    def test_serving_size_structured_parse(self):
        """FIX: serving size now also comes back structured, not just as
        opaque raw text, so a gram-equivalent can actually be compared
        against OpenFoodFacts' per-100g values."""
        result = parse_nutrition("Serving Size 1 Burger (99g)")
        parsed = result['serving_size_parsed']
        assert parsed['amount_g'] == 99.0
        assert parsed['household_measure'] == '1 Burger'
        assert parsed['ambiguous'] is False

    def test_serving_size_ambiguous_when_no_gram_equivalent(self):
        """FIX: a serving size with NO gram equivalent on the label at all
        (e.g. 'Serving Size 1 Bag') used to be stored as an opaque string
        indistinguishable from a parseable one. Now explicitly flagged."""
        result = parse_nutrition("Serving Size 1 Bag")
        parsed = result['serving_size_parsed']
        assert parsed['amount_g'] is None
        assert parsed['ambiguous'] is True

    def test_serving_size_canadian_per_format(self):
        """FIX: non-US labels say 'Per 2 slices (64 g)' instead of
        'Serving Size ...' -- this used to return no serving size at all."""
        result = parse_nutrition("Nutrition Facts\nPer 2 slices (64 g)\nCalories 140")
        parsed = result['serving_size_parsed']
        assert parsed['amount_g'] == 64.0

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
        dv = {'added_sugars_g': 4.0, 'sodium_mg': 5.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] >= 80

    def test_high_sugar_sodium_scores_lower(self):
        dv = {'added_sugars_g': 90.0, 'sodium_mg': 80.0, 'saturated_fat_g': 70.0}
        result = calculate_health_score(dv, nutrition_data={'calories': 500, 'trans_fat_g': 0})
        assert result['score'] < 80

    def test_missing_field_is_flagged_not_silently_zeroed(self):
        """Fixed: a missing added-sugar reading now produces a warning instead of
        being silently treated as a confirmed 0g. (Uses added_sugars_g, not
        total_sugars_g, since total sugars has no FDA %DV and isn't scored --
        see calculate_health_score()'s docstring.)"""
        dv_missing_sugar = {'sodium_mg': 5.0, 'saturated_fat_g': 0.0}  # no added_sugars_g key
        result = calculate_health_score(dv_missing_sugar, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert any('sugar' in w for w in result['warnings'])

    def test_trans_fat_now_penalized(self):
        """Fixed: trans fat used to contribute nothing to the score at all.
        This is the real photographed example from the accuracy review
        (unidentified_yellow_box_product_jpg.jpg): 3g trans fat/serving."""
        dv = {'added_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        clean_result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        trans_fat_result = calculate_health_score(dv, nutrition_data={'calories': 100, 'trans_fat_g': 3})
        assert trans_fat_result['score'] < clean_result['score']

    def test_no_barcode_match_no_longer_auto_penalized(self):
        """Fixed: previously EVERY product without an OpenFoodFacts match
        ate a flat -10 penalty regardless of its own label. Now, no lookup
        at all (nutriscore_grade=None) means no penalty either way."""
        dv = {'added_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutriscore_grade=None, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] == 100

    def test_genuinely_unknown_grade_after_lookup_still_penalized(self):
        dv = {'added_sugars_g': 0.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv, nutriscore_grade='unknown', nutrition_data={'calories': 100, 'trans_fat_g': 0})
        assert result['score'] == 90

    def test_total_sugars_not_used_for_scoring(self):
        """Fixed: total_sugars_g used to borrow added sugar's 50g FDA daily
        value as an unlabeled approximation (FDA publishes no %DV for total
        sugars at all). It's now excluded from DAILY_VALUES/scoring entirely
        -- a huge total_sugars_g %DV must NOT move the score, only
        added_sugars_g (which has a real FDA DV) should."""
        dv_with_bogus_total_sugar_dv = {'total_sugars_g': 500.0, 'sodium_mg': 0.0, 'saturated_fat_g': 0.0}
        result = calculate_health_score(dv_with_bogus_total_sugar_dv, nutrition_data={'calories': 100, 'trans_fat_g': 0})
        # total_sugars_g isn't a scored key at all, so it should behave
        # identically to added_sugars_g being MISSING: warn, don't penalize.
        assert result['score'] == 100
        assert any('added sugar' in w for w in result['warnings'])


class TestCleanNum:
    def test_letter_o_to_zero(self):
        assert _clean_num('O') == 0.0

    def test_normal_number(self):
        assert _clean_num('12.5') == 12.5

    def test_garbage_returns_none(self):
        assert _clean_num('abc') is None


# ---------------------------------------------------------------------------
# Robustness / multi-column regression tests (gaps #6 and #7)
# ---------------------------------------------------------------------------

class TestOcrConfidenceIgnoresBlankBoxes:
    """Gap #7 (rotated image): a photo where Tesseract extracted NO text still
    reported ~95% confidence and reliable=True, because its empty layout boxes
    (high conf, blank text) were averaged in. Reproduced with real Tesseract on
    a noise image and on an extremely blurred label; these tests lock the fix
    in without needing Tesseract, by feeding a controlled OCR result."""

    def _run(self, monkeypatch, tmp_path, conf, texts, full_text):
        from PIL import Image
        img_path = tmp_path / "label.png"
        Image.new("RGB", (800, 1000), "white").save(img_path)
        data = {"conf": conf, "text": texts}
        monkeypatch.setattr(npm.pytesseract, "image_to_data", lambda *a, **k: data)
        monkeypatch.setattr(npm.pytesseract, "image_to_string", lambda *a, **k: full_text)
        return extract_text_with_confidence(str(img_path))

    def test_blank_boxes_do_not_inflate_confidence(self, monkeypatch, tmp_path):
        result = self._run(monkeypatch, tmp_path, [95, 95, 40], ["", "", "word"], "word")
        assert result["avg_confidence"] == 40  # old behavior averaged in the blanks -> 76.7
        assert result["reliable"] is False

    def test_no_text_at_all_is_never_reliable(self, monkeypatch, tmp_path):
        result = self._run(monkeypatch, tmp_path, [95, 95, 95], ["", " ", ""], "")
        assert result["avg_confidence"] == 0
        assert result["reliable"] is False

    def test_confident_real_text_is_still_reliable(self, monkeypatch, tmp_path):
        result = self._run(monkeypatch, tmp_path, [90, 92, 95, -1], ["Calories", "230", "Fat", ""], "Calories 230 Fat")
        assert result["avg_confidence"] > 90
        assert result["reliable"] is True


class TestBestEffortReliabilityGuard:
    """Gap #7: even with honest confidence, 'reliable' must also require that
    real nutrition fields were actually parsed."""

    def _patch(self, monkeypatch, text, conf=95.0):
        ocr = {"text": text, "avg_confidence": conf, "reliable": conf >= 60, "low_confidence_words": []}
        monkeypatch.setattr(npm, "extract_text_with_confidence", lambda *a, **k: ocr)
        monkeypatch.setattr(npm, "extract_columns_if_present", lambda *a, **k: None)

    def test_high_confidence_but_zero_fields_is_not_reliable(self, monkeypatch):
        self._patch(monkeypatch, "some blurry unrelated words")
        result = extract_text_best_effort("unused.png")
        assert result["fields_found"] == 0
        assert result["reliable"] is False
        assert result["warnings"]

    def test_full_extraction_stays_reliable(self, monkeypatch):
        self._patch(monkeypatch, "Calories 230\nTotal Fat 8g\nSodium 160mg\nProtein 3g", conf=90.0)
        result = extract_text_best_effort("unused.png")
        assert result["fields_found"] >= 3
        assert result["reliable"] is True
        assert result["warnings"] == []


class TestDualColumnLabels:
    """Gap #6: dual-column ("Per Serving | Per Container") handling."""

    def test_normal_single_column_label_is_not_mistaken_for_dual_column(self):
        # Both phrases appear on every US label, far apart -- must NOT trigger.
        text = ("Nutrition Facts\nServings per container 4\nServing size 1 cup (240g)\n"
                "Amount per serving\nCalories 230\nTotal Fat 8g 10%\nSodium 160mg 7%")
        assert detect_serving_column_index(text) == 0
        result = parse_nutrition(text)
        assert result["calories"] == 230
        assert result["total_fat_g"] == 8.0

    def test_per_serving_first_takes_first_amount(self):
        text = "Calories Per Serving Per Container\n330 980\nTotal Fat 8g 10% 24g 31%\nSodium 220mg 9% 660mg 29%"
        assert detect_serving_column_index(text) == 0
        result = parse_nutrition(text)
        assert result["calories"] == 330
        assert result["total_fat_g"] == 8.0
        assert result["sodium_mg"] == 220.0

    def test_per_container_first_takes_second_amount(self):
        # Previously this silently returned the per-container numbers (980 / 24 / 660).
        text = "Calories Per Container Per Serving\n980 330\nTotal Fat 24g 31% 8g 10%\nSodium 660mg 29% 220mg 9%"
        assert detect_serving_column_index(text) == 1
        result = parse_nutrition(text)
        assert result["calories"] == 330
        assert result["total_fat_g"] == 8.0
        assert result["sodium_mg"] == 220.0

    def test_per_container_first_with_missing_second_amount_is_dropped_not_guessed(self):
        text = "Per Container | Per Serving\nCalories 980 330\nTrans Fat 0g"
        result = parse_nutrition(text)
        assert result["calories"] == 330
        assert "trans_fat_g" not in result  # only one amount on the row: refuse to guess the column

    def test_dual_column_header_line_is_not_a_serving_size(self):
        result = parse_nutrition("Per Serving | Per Container\nCalories 330 980")
        assert "serving_size" not in result

    def test_calories_regex_tolerates_header_words(self):
        assert parse_nutrition("Calories Per Serving 330")["calories"] == 330

    def test_choose_serving_column_prefers_explicit_header(self):
        columns = ["Amount Per Container\nTotal Fat 24g", "Amount Per Serving\nTotal Fat 8g"]
        col_parses = [parse_nutrition(c) for c in columns]
        assert _choose_serving_column(columns, col_parses) == (1, "header")

    def test_choose_serving_column_falls_back_when_no_clear_header(self):
        columns = ["Total Fat 8g\nSodium 160mg", "Total Fat 24g"]
        col_parses = [parse_nutrition(c) for c in columns]
        assert _choose_serving_column(columns, col_parses) == (0, "most_fields")


class TestTruncatedCalories:
    def test_clipped_first_letters_are_repaired(self):
        # Real Tesseract output on a 30-degree-rotated synthetic label.
        assert parse_nutrition("ories 230\nTotal Fat 8g")["calories"] == 230

    def test_ordinary_words_ending_in_ories_are_untouched(self):
        result = parse_nutrition("Categories 12\nStories 3\nTotal Fat 8g")
        assert "calories" not in result


class TestFsaNpmScore:
    # Every case here reproduces one of the six official worked examples
    # from "Nutrient Profiling Technical Guidance", Dept of Health, Jan
    # 2011 (Section 4), to lock in that this implementation matches the
    # real, published, government-adopted model exactly -- not just
    # internally-consistent numbers we made up ourselves.
    def test_worked_example_1_fruit_fromage_frais(self):
        nutrition = {'calories': 459 / 4.184, 'saturated_fat_g': 1.8, 'total_sugars_g': 13.4,
                     'sodium_mg': 0.1, 'fiber_g': 0.6, 'protein_g': 6.5}
        result = calculate_fsa_npm_score(nutrition, {'amount_g': 100.0, 'ambiguous': False}, fvn_percent=8)
        assert result['score'] == 0

    def test_worked_example_2_vanilla_ice_cream(self):
        nutrition = {'calories': 741 / 4.184, 'saturated_fat_g': 6.1, 'total_sugars_g': 18.7,
                     'sodium_mg': 60, 'fiber_g': 0, 'protein_g': 3.6}
        result = calculate_fsa_npm_score(nutrition, {'amount_g': 100.0, 'ambiguous': False})
        assert result['score'] == 12
        assert result['classification'] == 'less healthy'
        assert result['protein_excluded'] is True  # A points >= 11, FVN points < 5

    def test_worked_example_4_tomato_soup(self):
        nutrition = {'calories': 155 / 4.184, 'saturated_fat_g': 0.4, 'total_sugars_g': 3.6,
                     'sodium_mg': 471, 'fiber_g': 0.2, 'protein_g': 0.3}
        result = calculate_fsa_npm_score(nutrition, {'amount_g': 100.0, 'ambiguous': False})
        assert result['score'] == 5

    def test_worked_example_5_cereal_bar_with_fruit_content(self):
        nutrition = {'calories': 1504 / 4.184, 'saturated_fat_g': 1.4, 'total_sugars_g': 35.7,
                     'sodium_mg': 0, 'fiber_g': 4.8, 'protein_g': 4.3}
        result = calculate_fsa_npm_score(nutrition, {'amount_g': 100.0, 'ambiguous': False}, fvn_percent=46)
        assert result['score'] == 6

    def test_refuses_to_guess_when_serving_size_is_ambiguous(self):
        result = calculate_fsa_npm_score({'calories': 100}, {'amount_g': None, 'ambiguous': True})
        assert result['score'] is None
        assert 'ambiguous' in result['reason'].lower() or 'could not be determined' in result['reason'].lower()

    def test_refuses_when_no_serving_size_line_was_found_at_all(self):
        result = calculate_fsa_npm_score({'calories': 100}, None)
        assert result['score'] is None


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
