# 🥗 food-label-reader

Extracts nutrition information from food label photos using OCR, flags unhealthy sugar/sodium/fat levels based on WHO/FDA guidelines, and enriches results with data from OpenFoodFacts (Nutri-Score, NOVA processing group, Eco-Score).

Internship project exploring OCR, text parsing, and automated health insights.

## What it does

- **OCR extraction** — reads nutrition facts panels from photos (Tesseract, with preprocessing: deskew, contrast enhancement, quality checks)
- **Nutrition parsing** — pulls out calories, fat, sodium, carbs, sugar, protein, fiber, cholesterol, and vitamins/minerals
- **Health scoring** — 0–100 composite score based on WHO/FDA daily value thresholds
- **Ingredient intelligence** — detects allergens (milk, soy, nuts, gluten, etc.), additives, artificial sweeteners, and diet compatibility (vegan, keto, halal/kosher, paleo, low-FODMAP)
- **Barcode + OpenFoodFacts lookup** — scans barcodes in the photo and fetches Nutri-Score, Eco-Score, and NOVA processing group for the product
- **Personalized flags** — custom alerts based on a user profile (diabetic, hypertensive, allergies, weight/muscle goals)
- **Multi-image support** — upload several label photos in one go; each gets its own report and charts
- **Export** — save results as JSON and PDF; scan history logged to a local SQLite database

## How to run it

1. Open `food_label_reader_final.ipynb` in [Google Colab](https://colab.research.google.com/)
2. **Runtime → Run all**
3. When prompted, upload one or more nutrition label photos (Ctrl/Cmd+click to select multiple)
4. Each image's report — nutrition breakdown, health score, insights, and charts — prints automatically

No API key needed. OpenFoodFacts lookups only run if a barcode is detected in the photo.

## Known limitations

- OCR accuracy depends heavily on photo quality (lighting, blur, angle) — the notebook warns you if a photo looks unsuitable before processing it
- Nutri-Score/Eco-Score/NOVA data only appears if a barcode is visible **and** the product is registered on OpenFoodFacts
- Ingredient parsing works best on labels with a clearly printed "Ingredients:" section

## Tested on

11 real product photos (7 nutrition labels, 4 barcodes) across varying quality conditions — OCR misreads (e.g. `0`↔`O`, `g`↔digit confusion) are corrected using a %DV cross-check against the label's own printed daily-value percentages.

## Tech stack

Python, Tesseract OCR, OpenCV, pyzbar (barcode scanning), OpenFoodFacts API, matplotlib, SQLite, reportlab (PDF export)
