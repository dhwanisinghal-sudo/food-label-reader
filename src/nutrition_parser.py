"""
nutrition_parser.py

This module is the SAME logic that lives in food_label_reader_final.ipynb,
pulled out into an importable .py file. It exists so that:
  1. tests/Test_nutrition_parser.py can actually import something
     (previously it did `from app import ...` and `app.py` did not exist
     anywhere in the repo -> the whole test file failed to collect).
  2. evaluate_accuracy.py can run the real parsing/scoring pipeline against
     a ground-truth CSV without needing to re-run the whole notebook.

If you change a function in the notebook, copy the change here too (or,
better, make the notebook import from this file instead of duplicating
the code -- see "Suggested next step" at the bottom of this file).
"""

import re
import cv2
import numpy as np
import pytesseract
from PIL import Image


# ---------------------------------------------------------------------------
# 2. Image quality check & preprocessing
# ---------------------------------------------------------------------------

def check_image_quality(image_path):
    """Flags blurry, too-dark, or overexposed photos before we waste time on OCR."""
    img = cv2.imread(image_path)
    if img is None:
        return {'ok': False, 'issues': ['Could not read image'], 'blur_score': 0, 'brightness': 0}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness = gray.mean()

    issues = []
    if blur_score < 100:
        issues.append(f'Image looks blurry (sharpness: {blur_score:.1f}, want > 100)')
    if brightness < 60:
        issues.append(f'Image looks too dark (brightness: {brightness:.1f}/255)')
    elif brightness > 220:
        issues.append(f'Image looks overexposed/glare (brightness: {brightness:.1f}/255)')

    return {
        'ok': len(issues) == 0,
        'issues': issues,
        'blur_score': round(float(blur_score), 1),
        'brightness': round(float(brightness), 1),
    }


def deskew_image(image_path, output_path="deskewed.jpg"):
    """Straightens a rotated/angled photo of the label to improve OCR accuracy."""
    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.bitwise_not(gray)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]

    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) == 0:
        return image_path

    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle

    (h, w) = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    cv2.imwrite(output_path, rotated)
    return output_path


def preprocess_image(image_path, output_path="preprocessed.jpg"):
    """Grayscale + adaptive contrast + binary threshold.
    NOTE: as of the current notebook, this function is DEFINED but never
    CALLED from main() -- deskew_image() runs, this does not. Flagging that
    here so it isn't silently forgotten when you wire it back in."""
    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrast = clahe.apply(gray)
    _, thresh = cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cv2.imwrite(output_path, thresh)
    return output_path


# ---------------------------------------------------------------------------
# 3. OCR
# ---------------------------------------------------------------------------

def ensure_min_resolution(image_path, output_path="_resized.jpg", target_long_edge=2000):
    """Upscales small photos before OCR.

    REAL BUG FOUND during accuracy testing on actual uploaded photos: a
    314x235px photo (perfectly readable to a human) returned a completely
    EMPTY string from Tesseract -- not a misread, total extraction failure.
    Upscaling the same image 3x immediately produced real text. The
    server-side JS pipeline (src/server.js, via `sharp`) already resizes
    every upload to a 2000px long edge before OCR -- this notebook/Python
    path never had that step, which is a large chunk of why the notebook's
    measured OCR accuracy was so much worse than expected on real photos.
    """
    img = cv2.imread(image_path)
    if img is None:
        return image_path
    h, w = img.shape[:2]
    long_edge = max(h, w)
    if long_edge >= target_long_edge:
        return image_path
    scale = target_long_edge / long_edge
    resized = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(output_path, resized)
    return output_path


def extract_text_with_confidence(image_path, langs="eng+hin", psm=3):
    """Runs OCR with a given Tesseract page-segmentation mode and also
    reports how confident Tesseract is."""
    image_path = ensure_min_resolution(image_path, output_path=image_path + "._resized.jpg")
    img = Image.open(image_path)
    config = f"--psm {psm}"
    try:
        data = pytesseract.image_to_data(img, lang=langs, config=config, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(img, lang=langs, config=config)
    except pytesseract.TesseractError:
        data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(img, config=config)

    confidences = [int(c) for c in data['conf'] if c != '-1' and int(c) >= 0]
    avg_confidence = round(sum(confidences) / len(confidences), 1) if confidences else 0
    low_conf_words = [
        data['text'][i] for i, c in enumerate(data['conf'])
        if c != '-1' and 0 <= int(c) < 50 and data['text'][i].strip()
    ]

    return {
        'text': text,
        'avg_confidence': avg_confidence,
        'reliable': avg_confidence >= 60,
        'low_confidence_words': low_conf_words,
    }


def extract_text_best_effort(image_path, langs="eng+hin"):
    """Runs OCR TWICE with two different page-segmentation modes and merges
    the results, because testing on real photos showed neither mode wins on
    every layout:

      - psm 3 (auto layout analysis, Tesseract's default): correctly keeps
        a two-column layout (e.g. Nutrition Facts on the left, Ingredients
        + address text on the right) as two separate columns. But on a
        busy/angled photo (box held at an angle, wood table in the
        background) it sometimes stops after the first 2-3 lines entirely.
      - psm 6 (treat the whole image as one block of text): recovered the
        rest of the label on that busy/angled photo (72 chars -> 380
        chars). But on a genuine two-column label, it reads across both
        columns line-by-line and interleaves them into garbage -- which
        silently broke ingredient/allergen extraction on an image where
        psm 3 alone had worked fine.

    So: run both, parse both, and merge -- numeric nutrition fields prefer
    the psm 3 result (it's the safer default and rarely hallucinates a
    wrong number), falling back to psm 6 only for fields psm 3 missed
    entirely. For ingredients, keep whichever pass produced the LONGER
    parsed ingredient list, since a short/empty list is the signature of
    column interleaving. This is a workaround, not a real fix -- see
    `nutrition_parser.py` module docstring / accuracy report for the
    honest limitation this papers over.
    """
    ocr_a = extract_text_with_confidence(image_path, langs, psm=3)
    ocr_b = extract_text_with_confidence(image_path, langs, psm=6)

    parsed_a = parse_nutrition(ocr_a['text'])
    parsed_b = parse_nutrition(ocr_b['text'])
    merged_nutrition = {**parsed_b, **parsed_a}  # psm3 wins on conflicts, fills gaps from psm6

    ing_a = parse_ingredients(ocr_a['text'])
    ing_b = parse_ingredients(ocr_b['text'])
    best_ingredients = ing_a if len(ing_a) >= len(ing_b) else ing_b
    best_ocr_text = ocr_a['text'] if len(ing_a) >= len(ing_b) else ocr_b['text']

    return {
        'text': best_ocr_text,
        'nutrition': merged_nutrition,
        'ingredients': best_ingredients,
        'avg_confidence': max(ocr_a['avg_confidence'], ocr_b['avg_confidence']),
        'reliable': ocr_a['reliable'] or ocr_b['reliable'],
        'psm3_text': ocr_a['text'],
        'psm6_text': ocr_b['text'],
    }


# ---------------------------------------------------------------------------
# 4. Parsing
# ---------------------------------------------------------------------------

_NUM = r'([0-9OoIl]+\.?[0-9]*)'


def _clean_num(raw):
    """Converts an OCR'd number string (which may contain misread letters) to a float."""
    fixed = raw.replace('O', '0').replace('o', '0').replace('I', '1').replace('l', '1')
    try:
        return float(fixed)
    except ValueError:
        return None


# G_UNIT/MG_UNIT widened per src/nutritionParser.js's verified findings: real
# Tesseract output on real photos fuses the "g"/"mg" unit glyph into the
# number as a trailing 9 or 3 far more often than the original notebook
# patterns tolerated (e.g. "1.5g" -> "1.59", "2g" -> "29"), which silently
# failed to match at all under the old [g)] / [g3] classes.
_G_UNIT = r'[g)93]'
_MG_UNIT = r'm[ga9]'

NUTRITION_PATTERNS = {
    'calories': r'calories\s*' + _NUM,
    'total_fat_g': r'total fat\s*' + _NUM + r'\s*' + _G_UNIT,
    'saturated_fat_g': r'saturated fat\s*' + _NUM + r'\s*' + _G_UNIT,
    'trans_fat_g': r'trans fat\s*' + _NUM + r'\s*' + _G_UNIT,
    'cholesterol_mg': r'cholesterol\s*' + _NUM + r'\s*' + _MG_UNIT,
    'sodium_mg': r'sodium\s*' + _NUM + r'\s*' + _MG_UNIT,
    'total_carbs_g': r'total carboh[yi]d[nr]ate\s*' + _NUM + r'\s*' + _G_UNIT,
    'fiber_g': r'(?:dietary\s*)?fiber\s*(?:less than\s*)?' + _NUM + r'\s*' + _G_UNIT + '?',
    'total_sugars_g': r'(?:total\s+)?sugars\s*' + _NUM + r'\s*' + _G_UNIT,
    'added_sugars_g': r'includes\s*' + _NUM + r'\s*' + _G_UNIT + r'\s*added sugars',
    'protein_g': r'protein\s*' + _NUM + r'\s*' + _G_UNIT,
}

DAILY_VALUES = {
    'calories': 2000, 'total_fat_g': 78, 'saturated_fat_g': 20,
    'cholesterol_mg': 300, 'sodium_mg': 2300, 'total_carbs_g': 275,
    'fiber_g': 28, 'total_sugars_g': 50, 'added_sugars_g': 50, 'protein_g': 50,
}

_PLAUSIBLE_RANGE = {
    'calories': (0, 2000), 'total_fat_g': (0, 100), 'saturated_fat_g': (0, 60),
    'trans_fat_g': (0, 20), 'cholesterol_mg': (0, 500), 'sodium_mg': (0, 5000),
    'total_carbs_g': (0, 150), 'fiber_g': (0, 60), 'total_sugars_g': (0, 150),
    'added_sugars_g': (0, 150), 'protein_g': (0, 100),
}


def parse_nutrition(text):
    data = {}
    for key, pattern in NUTRITION_PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        value = _clean_num(match.group(1))
        if value is None:
            continue
        lo, hi = _PLAUSIBLE_RANGE.get(key, (0, float('inf')))
        if not (lo <= value <= hi):
            continue

        if key in DAILY_VALUES:
            # Bound the %DV lookahead at the next newline (in addition to the
            # 15-char cap). REAL BUG FOUND during accuracy testing: without
            # this, "Calories 140\n\nFat 1.5g 2%" let the cross-check window
            # bleed across the line break and grab FAT's "2%" as if it were
            # calories' declared %DV -- which then "corrected" a correctly
            # OCR'd 140 down to a wrong 40. The JS version
            # (src/nutritionParser.js) already had this newline bound; the
            # Python/notebook version did not.
            after_match = text[match.end():]
            newline_idx = after_match.find('\n')
            window_end = 15 if newline_idx == -1 else min(15, newline_idx)
            window = after_match[:window_end]
            pct_match = re.search(r'(\d{1,3})\s*%', window)
            if pct_match:
                declared_pct = float(pct_match.group(1))
                our_pct = (value / DAILY_VALUES[key]) * 100
                if declared_pct > 0 and our_pct > 0:
                    ratio = our_pct / declared_pct
                    if ratio > 2.5 or ratio < 0.4:
                        value = round(declared_pct / 100 * DAILY_VALUES[key], 2)

        data[key] = int(value) if key == 'calories' else value

    serving_match = re.search(r'serving size\s*([^\n]+)', text, re.IGNORECASE)
    if serving_match:
        data['serving_size'] = serving_match.group(1).strip()
    return data


def parse_ingredients(text):
    text = re.sub(r'ingredients\s*:?', '', text, flags=re.IGNORECASE, count=1).strip()
    stop_patterns = [
        r'nutrition facts', r'serving size', r'contains\s+(milk|soy|wheat|egg|nuts?|tree nuts?)',
        r'percent daily values', r'calories from fat', r'%\s*daily value',
    ]
    cut_idx = len(text)
    for pat in stop_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m and m.start() < cut_idx:
            cut_idx = m.start()
    text = text[:cut_idx].strip()
    text = re.sub(r'\s*\n\s*', ' ', text)
    items = [item.strip(' .') for item in text.split(',') if item.strip(' .')]
    items = [i for i in items if len(i) <= 60]
    return items


# ---------------------------------------------------------------------------
# 6. Ingredient intelligence
# ---------------------------------------------------------------------------

ALLERGEN_KEYWORDS = {
    'Milk/Dairy': ['milk', 'dairy', 'lactose', 'casein', 'whey', 'butter', 'cream', 'cheese'],
    'Soy': ['soy', 'soya', 'soybean'],
    'Wheat/Gluten': ['wheat', 'gluten', 'barley', 'rye', 'flour'],
    'Nuts': ['almond', 'cashew', 'walnut', 'peanut', 'pistachio', 'hazelnut'],
    'Egg': ['egg', 'albumin'],
    'Sesame': ['sesame', 'tahini'],
    'Sulphites': ['sulphite', 'sulfite', 'so2'],
    'Mustard': ['mustard'],
    'Celery': ['celery', 'celeriac'],
    'Fish': ['fish', 'anchovy', 'cod', 'salmon', 'tuna'],
    'Crustaceans': ['shrimp', 'prawn', 'crab', 'lobster'],
    'Molluscs': ['mussel', 'oyster', 'squid', 'snail', 'clam', 'scallop'],
}

VEGAN_CONFLICT_KEYWORDS = ['milk', 'whey', 'casein', 'egg', 'honey', 'gelatin', 'lard', 'meat', 'fish', 'chicken', 'beef', 'pork']


def detect_allergens(ingredients_list):
    detected = {}
    for ingredient in ingredients_list:
        ing_lower = ingredient.lower()
        for allergen, keywords in ALLERGEN_KEYWORDS.items():
            for keyword in keywords:
                if keyword in ing_lower:
                    detected.setdefault(allergen, [])
                    if ingredient not in detected[allergen]:
                        detected[allergen].append(ingredient)
                    break
    return detected


def check_diet_compatibility(ingredients_list):
    text = " ".join(ingredients_list).lower()
    vegan_conflicts = [kw for kw in VEGAN_CONFLICT_KEYWORDS if kw in text]
    return {'vegan_friendly': len(vegan_conflicts) == 0, 'vegan_conflicts': vegan_conflicts}


# ---------------------------------------------------------------------------
# 5 / 11. Health score
# ---------------------------------------------------------------------------

def calculate_daily_value_percent(nutrient_data, daily_values=DAILY_VALUES):
    return {
        nutrient: round((amount / daily_values[nutrient]) * 100, 1)
        for nutrient, amount in nutrient_data.items()
        if nutrient in daily_values and amount is not None
    }


def calculate_health_score(dv_percent, nova_group=None, nutriscore_grade='N/A', additives_found=None, nutrition_data=None):
    additives_found = additives_found or []
    if not nutrition_data:
        return {'score': None, 'label': 'N/A (no nutrition data extracted)'}

    score = 100
    for key, weight in [('saturated_fat_g', 0.3), ('total_sugars_g', 0.3), ('sodium_mg', 0.2)]:
        pct = dv_percent.get(key, 0)
        if pct > 20:
            score -= (pct - 20) * weight

    if nova_group == 4:
        score -= 15
    elif nova_group == 3:
        score -= 7

    grade_penalty = {'a': 0, 'b': 5, 'c': 12, 'd': 20, 'e': 28}
    score -= grade_penalty.get(str(nutriscore_grade).lower(), 10)
    score -= min(len(additives_found) * 3, 15)

    score = max(0, min(100, round(score)))
    if score >= 80:
        label = 'Excellent'
    elif score >= 60:
        label = 'Good'
    elif score >= 40:
        label = 'Moderate'
    else:
        label = 'Poor'
    return {'score': score, 'label': label}


# Suggested next step: once you're happy this file matches the notebook,
# replace the duplicated function defs inside food_label_reader_final.ipynb
# with `from nutrition_parser import *` at the top, so there is exactly ONE
# copy of this logic instead of two that can drift apart.
