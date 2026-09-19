"""
nutrition_parser.py

Extracted verbatim from notebooks/food_label_reader_final.ipynb (cells 3, 5, 7,
9, 11, 13) in https://github.com/dhwanisinghal-sudo/food-label-reader, commit
cd94d74 (2026-09-15), the current HEAD of main at the time of extraction.

This is NOT a rewrite. Every function body below is copy-pasted unchanged from
the notebook so that running evaluate_accuracy.py / pytest against this file
tells you how the REAL, currently-committed logic behaves -- not a cleaned-up
or "fixed" version of it. No standalone nutrition_parser.py existed anywhere
in the repo before this file was created; the logic previously lived only
inside notebook cells (Python) and, separately, as a hand-ported duplicate in
src/nutritionParser.js (JavaScript).

Heavy image/OCR dependencies (cv2, pytesseract, pyzbar) are imported inside a
try/except so this module can still be imported -- and the pure text-parsing
functions still used -- even in an environment where those aren't installed.
Calling check_image_quality / deskew_image / extract_text_with_confidence /
scan_barcode_from_image without those libraries installed will raise
ImportError at call time, not at import time.
"""

import re

try:
    import cv2
    import numpy as np
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False

try:
    import pytesseract
    from PIL import Image
    _HAS_TESSERACT = True
except ImportError:
    _HAS_TESSERACT = False

try:
    from pyzbar.pyzbar import decode as zbar_decode
    _HAS_PYZBAR = True
except ImportError:
    _HAS_PYZBAR = False


# ===================== Cell 5: Image quality check & preprocessing =====================

def check_image_quality(image_path):
    """Flags blurry, too-dark, or overexposed photos before we waste time on OCR."""
    if not _HAS_CV2:
        raise ImportError("check_image_quality requires opencv-python (cv2), which is not installed.")
    img = cv2.imread(image_path)
    if img is None:
        return {'ok': False, 'issues': ['Could not read image'], 'blur_score': 0, 'brightness': 0}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    brightness = gray.mean()
    height, width = gray.shape[:2]

    issues = []
    if blur_score < 100:
        issues.append(f'Image looks blurry (sharpness: {blur_score:.1f}, want > 100)')
    if brightness < 60:
        issues.append(f'Image looks too dark (brightness: {brightness:.1f}/255)')
    elif brightness > 220:
        issues.append(f'Image looks overexposed/glare (brightness: {brightness:.1f}/255)')
    # FIX (accuracy review): resolution was never checked at all. 10 of our
    # 15 real test photos were under 500px on the smaller dimension (some as
    # small as 235x252) and every one of them passed this check as 'ok':
    # True, then went on to fail OCR silently. 500px is a conservative floor
    # -- small nutrition-label print typically needs the panel itself to be
    # at least a few hundred px tall to stay legible to Tesseract.
    if min(height, width) < 500:
        issues.append(f'Image resolution too low for reliable OCR ({width}x{height}px, want smaller side >= 500px)')

    return {
        'ok': len(issues) == 0,
        'issues': issues,
        'blur_score': round(float(blur_score), 1),
        'brightness': round(float(brightness), 1),
        'resolution': f'{width}x{height}',
    }


def deskew_image(image_path, output_path="deskewed.jpg"):
    """Straightens a rotated/angled photo of the label to improve OCR accuracy."""
    if not _HAS_CV2:
        raise ImportError("deskew_image requires opencv-python (cv2), which is not installed.")
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
    """Grayscale + adaptive contrast + binary threshold -- the combo pytesseract likes best."""
    if not _HAS_CV2:
        raise ImportError("preprocess_image requires opencv-python (cv2), which is not installed.")
    img = cv2.imread(image_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrast = clahe.apply(gray)
    _, thresh = cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cv2.imwrite(output_path, thresh)
    return output_path


# ===================== Cell 7: OCR =====================

def extract_text_with_confidence(image_path, langs="eng+hin"):
    """Runs OCR and also reports how confident Tesseract is, so we can warn the
    user if the result is likely to be inaccurate."""
    if not _HAS_TESSERACT:
        raise ImportError("extract_text_with_confidence requires pytesseract + Pillow, which are not installed.")
    img = Image.open(image_path)
    try:
        data = pytesseract.image_to_data(img, lang=langs, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(img, lang=langs)
    except pytesseract.TesseractError:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        text = pytesseract.image_to_string(img)

    # FIX (accuracy review): only count confidence scores from boxes where
    # Tesseract actually detected non-blank text. Previously this included
    # every box with a valid conf value regardless of whether any text was
    # found there, which let a photo where OCR extracted literally nothing
    # (text == '') still report avg_confidence as high as 95.0 and
    # reliable=True -- a confidently-wrong result, which is worse than an
    # honestly-low one because nothing downstream flags it for review.
    # Reproduced on protein_jerky_bag.jpg and on a 15-degree-rotated test
    # image, both of which returned text='' at "95% confidence" before this fix.
    confidences = [
        int(c) for i, c in enumerate(data['conf'])
        if c != '-1' and int(c) >= 0 and data['text'][i].strip()
    ]
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


def scan_barcode_from_image(image_path):
    """Tries to read a barcode from the photo, which lets us skip straight to an
    OpenFoodFacts lookup instead of relying on a text search."""
    if not _HAS_CV2 or not _HAS_PYZBAR:
        raise ImportError("scan_barcode_from_image requires opencv-python and pyzbar, which are not installed.")
    img = cv2.imread(image_path)
    if img is None:
        return None, "Could not read image"

    barcodes = zbar_decode(img)
    if not barcodes:
        return None, "No barcode detected in image"

    results = [{'data': b.data.decode('utf-8'), 'type': b.type} for b in barcodes]
    return results, None


# ===================== Cell 9: Parsing =====================

# NOTE: OCR frequently misreads characters on blurry/small labels:
#   '0' <-> 'O' (letter)      e.g. "Fat Og" instead of "Fat 0g"
#   'g' <-> '9', ')', '3'     e.g. "36g" -> "369)", "13g" -> "133"
#   'mg' <-> 'ma'/'mq'        e.g. "7mg" -> "7ma"
# _NUM below accepts digits OR a lone 'O'/'o' (read as zero), and the unit is optional/fuzzy.
_NUM = r'([0-9OoIl]+\.?[0-9]*)'


def _clean_num(raw):
    """Converts an OCR'd number string (which may contain misread letters) to a float."""
    fixed = raw.replace('O', '0').replace('o', '0').replace('I', '1').replace('l', '1')
    try:
        return float(fixed)
    except ValueError:
        return None


NUTRITION_PATTERNS = {
    # FIX (accuracy review -- multi-column labels): real dual-column labels
    # (Per Serving | Per Container) often OCR as
    # "Calories Per Serving Per Container\n330 980" -- the original pattern
    # (calories\s*NUM) required the number right after the word "calories"
    # with only whitespace between, so it never matched at all here. The
    # optional (?:per\s*serving\s*)? / (?:per\s*container\s*)? groups let it
    # skip over that header text. This still picks the FIRST number after
    # "calories" (the per-serving value, printed first on every US label we
    # saw), matching how every other field in this file already resolves
    # dual-column ambiguity -- see the module-level note below.
    'calories': r'calories\s*(?:per\s*serving\s*)?(?:per\s*container\s*)?[:\s]*' + _NUM,
    'total_fat_g': r'total fat\s*' + _NUM + r'\s*[g)]',
    'saturated_fat_g': r'saturated fat\s*' + _NUM + r'\s*[g)]',
    'trans_fat_g': r'trans fat\s*' + _NUM + r'\s*[g)]',
    'cholesterol_mg': r'cholesterol\s*' + _NUM + r'\s*m[ga]',
    'sodium_mg': r'sodium\s*' + _NUM + r'\s*m[ga]',
    'total_carbs_g': r'total carboh[yi]d[nr]ate\s*' + _NUM + r'\s*[g)]',
    'fiber_g': r'(?:dietary\s*)?fiber\s*(?:less than\s*)?' + _NUM + r'\s*[g)]?',
    # Matches "Total Sugars 6g" AND plain "Sugars 6g" (both are common on real labels)
    'total_sugars_g': r'(?:total\s+)?sugars\s*' + _NUM + r'\s*[g)]',
    'added_sugars_g': r'includes\s*' + _NUM + r'\s*[g)]\s*added sugars',
    'protein_g': r'protein\s*' + _NUM + r'\s*[g3]',
}

# KNOWN LIMITATION (accuracy review -- multi-column labels): every pattern in
# NUTRITION_PATTERNS grabs the FIRST number after the nutrient's name via
# re.search (which stops at the first match). On a real dual-column label
# ("Total Fat 20g 61g" for Per Serving | Per Container), this happens to
# return the correct per-serving value only because US labels consistently
# print the per-serving column first, left-to-right. There is no actual
# column-awareness here: nothing identifies which number belongs to which
# column, so a label that ever printed the per-container value first would
# silently return the wrong number with no warning. Confirmed against a
# real dual-column label structure (based on jenis_ice_cream_double_dough.jpg's
# ground-truth per-serving/per-container values) -- see accuracy review notes.
# A real fix needs layout-aware parsing (column position, not just regex
# order), which is out of scope for this pass; flagging it here so it isn't
# mistaken for solved.

# Sanity bounds per nutrient (grams/mg per serving) -- catches cases where OCR
# glued a misread unit character onto the digits (e.g. "36g" misread as "369",
# where the literal digit '9' was actually the letter 'g'). Values outside these
# ranges are dropped rather than shown as obviously wrong numbers.
_PLAUSIBLE_RANGE = {
    'calories': (0, 2000), 'total_fat_g': (0, 100), 'saturated_fat_g': (0, 60),
    'trans_fat_g': (0, 20), 'cholesterol_mg': (0, 500), 'sodium_mg': (0, 5000),
    'total_carbs_g': (0, 150), 'fiber_g': (0, 60), 'total_sugars_g': (0, 150),
    'added_sugars_g': (0, 150), 'protein_g': (0, 100),
}

VITAMIN_PATTERNS = {
    'vitamin_a_mcg': r'vitamin a\s*(\d+\.?\d*)\s*mcg',
    'vitamin_c_mg': r'vitamin c\s*(\d+\.?\d*)\s*mg',
    'vitamin_d_mcg': r'vitamin d\s*(\d+\.?\d*)\s*mcg',
    'vitamin_b12_mcg': r'vitamin b12\s*(\d+\.?\d*)\s*mcg',
    'calcium_mg': r'calcium\s*(\d+\.?\d*)\s*mg',
    'iron_mg': r'iron\s*(\d+\.?\d*)\s*mg',
    'potassium_mg': r'potassium\s*(\d+\.?\d*)\s*mg',
    'magnesium_mg': r'magnesium\s*(\d+\.?\d*)\s*mg',
    'zinc_mg': r'zinc\s*(\d+\.?\d*)\s*mg',
    'folate_mcg': r'folate\s*(\d+\.?\d*)\s*mcg',
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
            continue  # likely an OCR misread (e.g. unit char glued onto the digits)

        # Cross-check against the label's own printed %DV, if one appears right
        # after this match. Short %DV digits (e.g. "5%") are far less prone to
        # OCR unit-letter confusion than amount+unit text (e.g. "1g" -> "19"),
        # so if our reading disagrees a lot with the label's own %DV, trust the
        # %DV and back-derive the amount from it instead.
        if key in DAILY_VALUES:
            window = text[match.end():match.end() + 15]
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


def parse_vitamins_minerals(text):
    data = {}
    for key, pattern in VITAMIN_PATTERNS.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            data[key] = float(match.group(1))
    return data


def parse_ingredients(text):
    text = re.sub(r'ingredients\s*:?', '', text, flags=re.IGNORECASE, count=1).strip()

    # Ingredient lists sit right after the word "Ingredients" and run until the
    # nutrition facts panel / allergen footnote starts. Cut there so we don't
    # swallow the whole rest of the label into one giant "ingredient".
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

    # Ingredient names often wrap across lines on the label (e.g. "Skim\nMilk]").
    # Fold those back into one line before splitting, so wrapped words like
    # "Skim Milk" survive as a single ingredient instead of being lost.
    text = re.sub(r'\s*\n\s*', ' ', text)

    items = [item.strip(' .') for item in text.split(',') if item.strip(' .')]
    # Drop obvious OCR noise: real ingredient names are short; long fragments
    # are leftover panel/footnote text that slipped past the stop patterns.
    items = [i for i in items if len(i) <= 60]
    return items


def extract_expiry_info(text):
    patterns = [
        r'(?:best before|exp(?:iry)?|use by)[:\s]*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})',
        r'(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    return "Not found"


def detect_certifications(raw_text):
    patterns = {
        'Halal Certified': r'halal\s*certifi',
        'Kosher Certified': r'kosher\s*certifi',
        'USDA Organic': r'usda\s*organic|certified organic',
        'Gluten-Free Certified': r'certified gluten[- ]free|gluten[- ]free certified',
        'Non-GMO Verified': r'non[- ]gmo',
        'Fair Trade': r'fair\s*trade',
    }
    return [name for name, pattern in patterns.items() if re.search(pattern, raw_text, re.IGNORECASE)]


def detect_cross_contamination_warning(raw_text):
    pattern = r'(may contain( traces of)?|processed in a facility that (also )?(processes|handles))\s*([^.\n]+)'
    match = re.search(pattern, raw_text, re.IGNORECASE)
    return match.group(0).strip() if match else None


# ===================== Cell 11: Daily value % and insights =====================

DAILY_VALUES = {
    'calories': 2000, 'total_fat_g': 78, 'saturated_fat_g': 20,
    'cholesterol_mg': 300, 'sodium_mg': 2300, 'total_carbs_g': 275,
    'fiber_g': 28, 'total_sugars_g': 50, 'added_sugars_g': 50, 'protein_g': 50,
}

VITAMIN_DAILY_VALUES = {
    'vitamin_d_mcg': 20, 'calcium_mg': 1300, 'iron_mg': 18, 'potassium_mg': 4700,
}


def calculate_daily_value_percent(nutrient_data, daily_values=DAILY_VALUES):
    return {
        nutrient: round((amount / daily_values[nutrient]) * 100, 1)
        for nutrient, amount in nutrient_data.items()
        if nutrient in daily_values and amount is not None
    }


def generate_readable_insights(dv_percent):
    insights = []
    for nutrient, pct in dv_percent.items():
        name = nutrient.replace('_g', '').replace('_mg', '').replace('_', ' ').title()
        if pct >= 40:
            insights.append(f"HIGH: {name} — {pct}% of your daily value in one serving")
        elif pct >= 20:
            insights.append(f"MODERATE: {name} — {pct}% of your daily value")
        elif pct <= 5:
            insights.append(f"LOW: {name} — only {pct}% of your daily value")
    return insights


def estimate_glycemic_load_risk(parsed_data):
    carbs = parsed_data.get('total_carbs_g', 0)
    fiber = parsed_data.get('fiber_g', 0)
    sugar = parsed_data.get('total_sugars_g', 0)
    net_carbs = carbs - fiber

    if sugar >= 15 and fiber < 3:
        risk = "HIGH — likely to spike blood sugar quickly"
    elif sugar >= 8 or net_carbs >= 20:
        risk = "MODERATE"
    else:
        risk = "LOW"
    return {'net_carbs_g': round(net_carbs, 1), 'blood_sugar_spike_risk': risk}


def calculate_health_score(dv_percent, nova_group=None, nutriscore_grade=None, additives_found=None, nutrition_data=None):
    """A 0-100 composite score: starts at 100 and loses points for high
    saturated fat/sugar/sodium, heavy processing, poor Nutri-Score, and additives.
    Returns score=None/label='N/A' if there isn't enough nutrition data to score fairly
    (e.g. the photo was a barcode-only image and OCR found no nutrition facts).

    FIX (accuracy review, see test_nutrition_parser.py): nova_group,
    nutriscore_grade and additives_found now default to None/None/[] instead
    of being required positional arguments. Every real caller only reliably
    has dv_percent + nutrition_data on hand at call time -- the other three
    only exist when a barcode was scanned AND matched on OpenFoodFacts, which
    is the exception, not the rule (see openFoodFacts.js: lookupProduct
    returns found=False whenever there's no barcode or no OFF match). Making
    them required meant every caller without a barcode match -- almost all
    of them -- would crash before this fix.

    FIX (accuracy review, missing-value bug): previously, a scored field
    that OCR simply never found (e.g. sugar wasn't detected on the label at
    all) was scored identically to that field being CONFIRMED at 0 -- via
    `dv_percent.get(key, 0)` -- silently giving the best possible score for
    data that was never actually read. This inflates the score for exactly
    the photos where OCR did the worst job, which is the opposite of what a
    health-flagging tool should do. Now: dv_percent.get(...) still can't
    invent a value the OCR never found (there is nothing safe to guess), but
    missing scored fields are now returned as 'missing_fields' and appended
    to the label, so the result honestly signals "not fully verified" rather
    than presenting an unverified score as if it were a confirmed one.
    """
    if additives_found is None:
        additives_found = []

    if not nutrition_data:
        return {'score': None, 'label': 'N/A (no nutrition data extracted)', 'missing_fields': []}

    scored_fields = ['saturated_fat_g', 'total_sugars_g', 'sodium_mg']
    missing_fields = [key for key in scored_fields if key not in dv_percent]

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

    if missing_fields:
        label += f" (Incomplete data — {', '.join(missing_fields)} not detected; score may be optimistic)"

    return {'score': score, 'label': label, 'missing_fields': missing_fields}


# ===================== Cell 13: Ingredient intelligence =====================

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

ADDITIVE_KEYWORDS = [
    'sodium benzoate', 'sodium nitrite', 'potassium sorbate', 'msg', 'monosodium glutamate',
    'artificial flavor', 'artificial color', 'aspartame', 'high fructose corn syrup', 'bha', 'bht',
    'sodium bisulfite', 'tartrazine', 'red 40', 'yellow 5', 'blue 1',
]

ARTIFICIAL_SWEETENERS = ['aspartame', 'sucralose', 'saccharin', 'acesulfame', 'stevia', 'xylitol', 'sorbitol', 'erythritol']

VEGAN_CONFLICT_KEYWORDS = ['milk', 'whey', 'casein', 'egg', 'honey', 'gelatin', 'lard', 'meat', 'fish', 'chicken', 'beef', 'pork']
VEGETARIAN_CONFLICT_KEYWORDS = ['gelatin', 'lard', 'meat', 'fish', 'chicken', 'beef', 'pork', 'rennet']
NON_HALAL_KOSHER_KEYWORDS = ['pork', 'lard', 'gelatin', 'alcohol', 'wine', 'rum', 'bacon', 'ham']
HIGH_CARB_KEYWORDS = ['sugar', 'corn syrup', 'wheat flour', 'rice', 'maltodextrin', 'dextrose']
PALEO_CONFLICT_KEYWORDS = ['sugar', 'wheat', 'corn', 'dairy', 'milk', 'legume', 'soy', 'peanut', 'artificial']
FODMAP_CONFLICT_KEYWORDS = ['garlic', 'onion', 'honey', 'high fructose corn syrup', 'wheat', 'inulin', 'sorbitol', 'xylitol']


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


def detect_additives(ingredients_list):
    found = []
    for ingredient in ingredients_list:
        ing_lower = ingredient.lower()
        for additive in ADDITIVE_KEYWORDS:
            if additive in ing_lower:
                found.append(ingredient)
                break
    return found


def detect_sweeteners(ingredients_list):
    text = " ".join(ingredients_list).lower()
    found = [sw for sw in ARTIFICIAL_SWEETENERS if sw in text]
    return found if found else "No artificial sweeteners detected"


def check_diet_compatibility(ingredients_list):
    text = " ".join(ingredients_list).lower()
    vegan_conflicts = [kw for kw in VEGAN_CONFLICT_KEYWORDS if kw in text]
    veg_conflicts = [kw for kw in VEGETARIAN_CONFLICT_KEYWORDS if kw in text]
    return {
        'vegan_friendly': len(vegan_conflicts) == 0, 'vegan_conflicts': vegan_conflicts,
        'vegetarian_friendly': len(veg_conflicts) == 0, 'vegetarian_conflicts': veg_conflicts,
    }


def check_halal_kosher(ingredients_list):
    text = " ".join(ingredients_list).lower()
    conflicts = [kw for kw in NON_HALAL_KOSHER_KEYWORDS if kw in text]
    return {'halal_kosher_safe': len(conflicts) == 0, 'conflicts': conflicts}


def check_keto_compatibility(parsed_data, ingredients_list):
    carbs = parsed_data.get('total_carbs_g', 0)
    fiber = parsed_data.get('fiber_g', 0)
    net_carbs = max(carbs - fiber, 0)
    text = " ".join(ingredients_list).lower()
    conflicts = [kw for kw in HIGH_CARB_KEYWORDS if kw in text]
    return {'keto_friendly': net_carbs <= 10 and len(conflicts) == 0, 'net_carbs_g': net_carbs, 'conflicts': conflicts}


def check_paleo_compatibility(ingredients_list):
    text = " ".join(ingredients_list).lower()
    conflicts = [kw for kw in PALEO_CONFLICT_KEYWORDS if kw in text]
    return {'paleo_friendly': len(conflicts) == 0, 'conflicts': conflicts}


def check_fodmap_compatibility(ingredients_list):
    text = " ".join(ingredients_list).lower()
    conflicts = [kw for kw in FODMAP_CONFLICT_KEYWORDS if kw in text]
    return {'low_fodmap': len(conflicts) == 0, 'conflicts': conflicts}
