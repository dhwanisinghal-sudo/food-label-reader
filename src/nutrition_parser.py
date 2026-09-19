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

    result = {
        'text': best_ocr_text,
        'nutrition': merged_nutrition,
        'ingredients': best_ingredients,
        'avg_confidence': max(ocr_a['avg_confidence'], ocr_b['avg_confidence']),
        'reliable': ocr_a['reliable'] or ocr_b['reliable'],
        'psm3_text': ocr_a['text'],
        'psm6_text': ocr_b['text'],
        'columns_detected': False,
    }

    # Two-column layout fix: if a genuine two-column split is found AND
    # parsing one column alone recovers MORE nutrition fields than the
    # merged whole-image parse above, use that column instead. This
    # specifically targets the dual-column ("Per Serving | Per Container")
    # labels that used to fail almost entirely -- see accuracy_report.md.
    try:
        columns = extract_columns_if_present(image_path, langs)
    except Exception:
        columns = None

    if columns:
        col_parses = [parse_nutrition(col_text) for col_text in columns]
        best_col_idx = max(range(len(col_parses)), key=lambda i: len(col_parses[i]))
        if len(col_parses[best_col_idx]) > len(merged_nutrition):
            result['nutrition'] = col_parses[best_col_idx]
            result['text'] = columns[best_col_idx]
            result['columns_detected'] = True
            result['column_texts'] = columns

    return result



# ---------------------------------------------------------------------------
# 3b. Two-column label handling ("Per Serving | Per Container" side by side)
# ---------------------------------------------------------------------------
# REAL, PREVIOUSLY-UNRESOLVED LIMITATION: dual-column labels (two of the 15
# test images -- jenis_ice_cream_double_dough, savoritz_parmesan_crisps --
# use this layout) were failing on almost every field, because psm 6 (the
# fallback above for busy/angled photos) reads across both columns
# line-by-line and interleaves them into garbage. psm 3 alone sometimes
# keeps the columns separate in its raw text ordering, but parse_nutrition
# has no concept of "column" -- it just regex-searches the whole string, so
# a value that happens to land next to the wrong column's number can still
# get matched incorrectly.
#
# This adds a real fix: use Tesseract's word-level bounding boxes
# (pytesseract.image_to_data, already used by extract_text_with_confidence)
# to detect a genuine vertical gap splitting the words into two groups, and
# reconstruct each column as its own line-ordered text block. Each column is
# then parsed SEPARATELY, so a "Per Serving" number is never regex-matched
# alongside a "Per Container" number from the other column.

def _reconstruct_columns_from_words(data, image_width, min_gap_fraction=0.12):
    """Groups pytesseract image_to_data words into two columns if a single,
    wide, unambiguous horizontal gap splits them -- otherwise returns
    [None], meaning "no confident column split, don't use this path"."""
    words = []
    n = len(data.get('text', []))
    for i in range(n):
        text = (data['text'][i] or '').strip()
        try:
            conf = int(data['conf'][i])
        except (ValueError, TypeError, KeyError):
            conf = -1
        if not text or conf < 0:
            continue
        words.append({
            'text': text,
            'left': data['left'][i],
            'top': data['top'][i],
            'width': data['width'][i],
            'height': data['height'][i],
        })

    if len(words) < 6:
        return [None]  # too little text to make a meaningful column call

    centers = sorted(w['left'] + w['width'] / 2 for w in words)
    gaps = [(centers[i + 1] - centers[i], centers[i], centers[i + 1]) for i in range(len(centers) - 1)]
    biggest_gap, gap_start, gap_end = max(gaps, key=lambda g: g[0])

    if biggest_gap < image_width * min_gap_fraction:
        return [None]  # no gap wide enough to be a real column boundary, not just word spacing

    split_x = (gap_start + gap_end) / 2
    left_words = [w for w in words if (w['left'] + w['width'] / 2) < split_x]
    right_words = [w for w in words if (w['left'] + w['width'] / 2) >= split_x]

    # Require BOTH sides to have a real amount of text -- otherwise this is
    # more likely a logo/watermark/page-number sitting apart from one main
    # block of text, not a genuine two-column nutrition panel.
    if len(left_words) < 4 or len(right_words) < 4:
        return [None]

    def words_to_text(word_list):
        word_list = sorted(word_list, key=lambda w: w['top'])
        rows = []
        for w in word_list:
            placed = False
            for row in rows:
                if abs(row[0]['top'] - w['top']) < max(row[0]['height'], w['height']) * 0.6:
                    row.append(w)
                    placed = True
                    break
            if not placed:
                rows.append([w])
        rows.sort(key=lambda row: sum(w['top'] for w in row) / len(row))
        lines = []
        for row in rows:
            row.sort(key=lambda w: w['left'])
            lines.append(' '.join(w['text'] for w in row))
        return '\n'.join(lines)

    return [words_to_text(left_words), words_to_text(right_words)]


def extract_columns_if_present(image_path, langs="eng+hin"):
    """Returns [left_column_text, right_column_text] if a confident
    two-column layout is detected, else None (caller should fall back to
    extract_text_best_effort's single/merged text)."""
    resized_path = ensure_min_resolution(image_path, output_path=image_path + "._resized_cols.jpg")
    img = Image.open(resized_path)
    config = "--psm 3"
    try:
        data = pytesseract.image_to_data(img, lang=langs, config=config, output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractError:
        data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)

    columns = _reconstruct_columns_from_words(data, img.width)
    if len(columns) < 2 or columns[0] is None:
        return None
    return columns


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


def parse_serving_size(text):
    """Extracts a STRUCTURED serving size instead of leaving it as opaque raw
    text. REAL GAP FOUND (and now fixed): a label like "Serving Size 1 Bag"
    was previously just stored as the raw string "1 Bag" with no numeric
    gram amount at all -- there was no way to compare it against
    OpenFoodFacts' per-100g values, or to know how many grams "one serving"
    actually is. This still can't invent a number that isn't on the label,
    but it now explicitly says so via `ambiguous: True` instead of silently
    returning an opaque string that looks the same whether it was parseable
    or not.

    Returns None if no "Serving Size" line was found at all, otherwise:
    {
      'raw': the original text after "Serving Size",
      'amount_g': float grams if extractable, else None,
      'household_measure': e.g. "1 cup", "2 slices", "4oz" (text before any
                            parenthetical gram amount), else None,
      'ambiguous': True if no gram-equivalent could be extracted at all --
                   callers must NOT assume a serving is 100g or any other
                   default when this is True.
    }
    """
    m = re.search(r'serving size\s*([^\n]+)', text, re.IGNORECASE)
    if not m:
        # Non-US ("Canadian") labels often say "Per 2 slices (64 g)" instead
        # of "Serving Size ...". Anchored to the start of a line so this
        # doesn't accidentally match "servings PER container" appearing
        # mid-line elsewhere on the label.
        m = re.search(r'^\s*per\s+([^\n]+)', text, re.IGNORECASE | re.MULTILINE)
    if not m:
        return None
    raw = m.group(1).strip()

    amount_g = None
    # Case 1: parenthetical grams, e.g. "1 cup (240 g)", "2 slices (64g)"
    paren_match = re.search(r'\(\s*' + _NUM + r'\s*' + _G_UNIT + r'\s*[/)]', raw, re.IGNORECASE)
    if paren_match:
        val = _clean_num(paren_match.group(1))
        if val is not None and 0 < val <= 1000:
            amount_g = val
    if amount_g is None:
        # Case 2: grams given directly with no parentheses, e.g. "100g/3.5oz"
        direct_match = re.search(r'^\s*' + _NUM + r'\s*g\b', raw, re.IGNORECASE)
        if direct_match:
            val = _clean_num(direct_match.group(1))
            if val is not None and 0 < val <= 1000:
                amount_g = val

    household_match = re.match(r'([^(]+)', raw)
    household = household_match.group(1).strip() if household_match else None
    if household:
        household = household.rstrip('/').strip() or None

    return {
        'raw': raw,
        'amount_g': amount_g,
        'household_measure': household,
        'ambiguous': amount_g is None,
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

    # FIX (real gap found): also attach a structured parse of the serving
    # size instead of leaving callers to re-parse the raw string themselves.
    # See parse_serving_size()'s docstring for what 'ambiguous' means. Also
    # now covers non-US "Per X" labels, so serving_size (raw) is set from
    # the same parse instead of a separate regex that only matched "Serving
    # Size ..." and silently missed the Canadian format.
    parsed_serving = parse_serving_size(text)
    if parsed_serving is not None:
        data['serving_size'] = parsed_serving['raw']
        data['serving_size_parsed'] = parsed_serving
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

# BUG FIX (found during accuracy review): plain substring matching flagged
# "Eggplant" as an Egg allergen/vegan conflict because "egg" is a substring
# of "eggplant". Switched to \b word-boundary matching below, which fixes
# compound WORDS like "eggplant" (no space) automatically. It does NOT fix
# compound PHRASES like "coconut milk", where "milk" really is its own
# word -- so those need an explicit exceptions list instead.
_PLANT_MILK_EXCEPTIONS = [
    'coconut milk', 'almond milk', 'soy milk', 'soya milk', 'oat milk',
    'rice milk', 'cashew milk', 'hemp milk', 'pea milk',
]


def _strip_plant_milk_exceptions(text):
    """Removes known non-dairy 'X milk' phrases before checking the 'milk'
    keyword, so e.g. an ingredient list containing only 'Coconut Milk' does
    not get flagged as containing dairy."""
    cleaned = text
    for phrase in _PLANT_MILK_EXCEPTIONS:
        cleaned = cleaned.replace(phrase, '')
    return cleaned


def _keyword_matches(keyword, text):
    """Word-boundary match instead of plain substring containment.
    'egg' matches 'egg whites' and 'egg, salt' but NOT 'eggplant'.

    REGRESSION FOUND AND FIXED: the original word-boundary fix (\\begg\\b)
    was too strict -- it also stopped matching the PLURAL form, e.g.
    "Contains: EGGS" no longer matched 'egg' at all, because there is no
    word boundary between 'g' and 's' in "eggs" (both are word characters).
    This silently broke allergen detection on real labels, which very
    commonly use plurals ("Eggs", "Almonds", "Peanuts", "Walnuts"). Allowing
    an optional trailing 's' keeps "eggplant" correctly excluded (neither
    "egg\\b" nor "eggs\\b" matches inside "eggplant") while restoring
    plural matches.
    """
    if keyword == 'milk':
        text = _strip_plant_milk_exceptions(text)
    return re.search(r'\b' + re.escape(keyword) + r's?\b', text) is not None


def detect_allergens(ingredients_list):
    detected = {}
    for ingredient in ingredients_list:
        ing_lower = ingredient.lower()
        for allergen, keywords in ALLERGEN_KEYWORDS.items():
            for keyword in keywords:
                if _keyword_matches(keyword, ing_lower):
                    detected.setdefault(allergen, [])
                    if ingredient not in detected[allergen]:
                        detected[allergen].append(ingredient)
                    break
    return detected


def parse_declared_allergens(text):
    """REAL GAP FOUND: allergen detection only ever looked at the parsed
    ingredient list -- it never used the standardized "Contains: X, Y" or
    precautionary "May contain: X, Y" statements that real labels print
    specifically FOR allergen disclosure (these are often more reliable
    than inferring allergens from ingredient names, and are required by
    law on US labels when applicable). parse_ingredients() explicitly stops
    BEFORE these statements (they're not ingredients), so they were
    silently discarded entirely.

    Returns {'contains': [...], 'may_contain': [...]} -- category names
    matching ALLERGEN_KEYWORDS' keys. Both lists are empty if neither
    statement is found on the label.
    """
    def _categories_in(phrase):
        cats = []
        phrase_lower = phrase.lower()
        for allergen, keywords in ALLERGEN_KEYWORDS.items():
            if any(_keyword_matches(kw, phrase_lower) for kw in keywords) and allergen not in cats:
                cats.append(allergen)
        return cats

    result = {'contains': [], 'may_contain': []}
    # "May contain" is checked and stripped out first, so a search for the
    # plain "Contains" statement afterward can't accidentally match inside
    # the words "...may CONTAIN traces of...".
    may_match = re.search(r'may contain\s*:?\s*([^.\n]+)', text, re.IGNORECASE)
    if may_match:
        result['may_contain'] = _categories_in(may_match.group(1))
        text = text[:may_match.start()] + text[may_match.end():]
    contains_match = re.search(r'\bcontains\s*:?\s*([^.\n]+)', text, re.IGNORECASE)
    if contains_match:
        result['contains'] = _categories_in(contains_match.group(1))
    return result


def detect_allergens_full(text, ingredients_list):
    """Combines allergen detection from the ingredient list (detect_allergens)
    WITH the label's own declared "Contains:"/"May contain:" statements
    (parse_declared_allergens), since either source alone misses cases the
    other catches -- see parse_declared_allergens' docstring. Returns
    {'confirmed': {allergen: [source, ...]}, 'may_contain': [allergen, ...]}.
    'confirmed' merges ingredient-list matches and "Contains:" statement
    matches (both are definite); 'may_contain' stays separate since it's
    explicitly precautionary, not definite.
    """
    from_ingredients = detect_allergens(ingredients_list)
    declared = parse_declared_allergens(text)

    confirmed = {k: list(v) for k, v in from_ingredients.items()}
    for allergen in declared['contains']:
        confirmed.setdefault(allergen, [])
        if '(declared: "Contains" statement)' not in confirmed[allergen]:
            confirmed[allergen].append('(declared: "Contains" statement)')

    may_contain = [a for a in declared['may_contain'] if a not in confirmed]
    return {'confirmed': confirmed, 'may_contain': may_contain}


def check_diet_compatibility(ingredients_list):
    text = " ".join(ingredients_list).lower()
    vegan_conflicts = [kw for kw in VEGAN_CONFLICT_KEYWORDS if _keyword_matches(kw, text)]
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


def calculate_health_score(dv_percent, nova_group=None, nutriscore_grade=None, additives_found=None, nutrition_data=None):
    """
    CHANGES from the original version (bugs found during the accuracy review):

    1. Trans fat now contributes to the score. It was completely absent
       before -- a label with 3g trans fat per serving scored no worse than
       one with 0g. Trans fat has no FDA/WHO daily-value % (real labels
       never print a %DV next to it), so it can't use the same %DV-over-20%
       formula as sat fat/sugar/sodium. Instead it's a flat, harsh penalty
       per gram (WHO guidance treats trans fat as having no safe threshold),
       capped so one bad label can't single-handedly zero the score.

    2. `nutriscore_grade` now defaults to None instead of 'N/A', and the
       "unknown grade" penalty is ONLY applied when a grade was actually
       looked up and came back unrecognized -- not when no barcode/OFF
       lookup happened at all. Previously, EVERY product without a barcode
       match silently ate a -10 penalty regardless of how healthy its own
       label was. Now: no OFF data at all -> no penalty either way (score
       reflects the label's own numbers only). Reported an actual "N/A"-ish
       grade after a lookup -> still penalized, since that's a genuine
       "we don't know" signal instead of "we never asked".

    3. `warnings`: if a key nutrient (sugar, sodium, saturated fat, trans
       fat) is completely MISSING from dv_percent/nutrition_data (not
       measured, not just zero), that's flagged in the output instead of
       silently scoring as if it were confirmed to be 0. The score itself
       still can't penalize what wasn't extracted -- that would require
       guessing a number -- but callers/UI can now show "this score may be
       incomplete" instead of presenting it as equally confident as a label
       where every field was actually read.
    """
    additives_found = additives_found or []
    nutrition_data = nutrition_data or {}
    if not nutrition_data:
        return {'score': None, 'label': 'N/A (no nutrition data extracted)', 'warnings': []}

    warnings = []
    score = 100
    for key, weight in [('saturated_fat_g', 0.3), ('total_sugars_g', 0.3), ('sodium_mg', 0.2)]:
        if key not in dv_percent:
            warnings.append(f"{key.replace('_', ' ')} was not detected on the label -- score may be underestimated")
            continue
        pct = dv_percent[key]
        if pct > 20:
            score -= (pct - 20) * weight

    trans_fat = nutrition_data.get('trans_fat_g')
    if trans_fat is None:
        warnings.append("trans fat was not detected on the label -- score may be underestimated")
    elif trans_fat > 0:
        score -= min(trans_fat * 10, 30)

    if nova_group == 4:
        score -= 15
    elif nova_group == 3:
        score -= 7

    grade_penalty = {'a': 0, 'b': 5, 'c': 12, 'd': 20, 'e': 28}
    if nutriscore_grade is not None:
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
    return {'score': score, 'label': label, 'warnings': warnings}


# Suggested next step: once you're happy this file matches the notebook,
# replace the duplicated function defs inside food_label_reader_final.ipynb
# with `from nutrition_parser import *` at the top, so there is exactly ONE
# copy of this logic instead of two that can drift apart.
