<div align="center">

# 🥗 Food Label Reader

### OCR-powered nutrition label scanner with health scoring & diet intelligence

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tesseract OCR](https://img.shields.io/badge/Tesseract-OCR-4285F4?style=for-the-badge&logo=googlelens&logoColor=white)](https://github.com/tesseract-ocr/tesseract)
[![OpenFoodFacts](https://img.shields.io/badge/OpenFoodFacts-API-00AA55?style=for-the-badge&logo=googlemaps&logoColor=white)](https://world.openfoodfacts.org/)

**Snap a photo of a nutrition label — get a full health breakdown, allergen flags, and diet compatibility in seconds.**

*Internship project exploring OCR, text parsing, and automated health insights.*

[What It Does](#-what-it-does) • [How to Run](#-how-to-run-it) • [Accuracy](#-accuracy--testing) • [Health Scoring](#-health-scoring) • [Limitations](#-known-limitations)

</div>

---

## 🧾 Overview

Food Label Reader turns a photo of a nutrition facts panel into a structured, personalized health report. It reads the label with OCR, cross-checks the numbers, scores the product, flags allergens and additives, checks diet compatibility, and — if a barcode is visible — enriches everything with live data from OpenFoodFacts (Nutri-Score, NOVA group, Eco-Score).

The project exists in **three implementations**, developed independently and kept behaviorally consistent where it matters:

- **`notebooks/food_label_reader_final.ipynb`** — the original Python/Colab prototype
- **Web app** (`index.html` + `src/*.js`) — a Node/Express backend with a browser frontend
- **Mobile app** (`mobile-app/`) — a React Native/Expo app, using the same backend as the web app

`src/nutrition_parser.py` and `src/nutritionParser.js` implement the same core logic (parsing, health scoring, diet checks) independently in each language, kept in sync deliberately — see [Health Scoring](#-health-scoring) for why two implementations exist and how they're verified to agree.

## ✨ What It Does

| Feature | Notebook | Web App | Mobile App |
|---|:---:|:---:|:---:|
| OCR extraction (Tesseract) | ✅ | ✅ | ✅ (via the web app's backend) |
| Multi-image upload (one photo processed at a time, individual reports) | ✅ | ✅ | ✅ |
| Nutrition parsing (calories, fat, sodium, carbs, sugar, protein, fiber, cholesterol, vitamins/minerals) | ✅ | ✅ | ✅ |
| Custom health score (0–100 heuristic, documented in [Health Scoring](#-health-scoring)) | ✅ | ✅ | ✅ |
| **FSA/Ofcom Nutrient Profiling Model score** (published, government-adopted model — see [Health Scoring](#-health-scoring)) | ✅ | ✅ | ✅ |
| Allergen / additive detection | ✅ | ✅ | ✅ |
| Diet compatibility (vegan, vegetarian, keto, halal/kosher, paleo, low-FODMAP) | ✅ | ✅ | ✅ |
| Barcode + OpenFoodFacts lookup | ✅ | ✅ | ✅ |
| Personalized flags from a user profile | ✅ | ✅ | ✅ |
| Export to JSON/PDF | ✅ | ✅ | ✅ |
| Scan history | SQLite, local to that notebook session, **optionally also synced to your account** | MongoDB, saved per logged-in account | Reads the same MongoDB history as the web app |
| Accounts / login | ✅ *(opt-in — log in with the same account used on the web app; the notebook still does its own OCR/parsing locally, it just also posts finished results to `POST /api/history`)* | ✅ (email + password, JWT) | ✅ (shares the web app's accounts) |

## 🌐 Try It Live

- **Web app:** https://food-label-reader-1.onrender.com  
  (Render's free tier sleeps when idle — the first load after inactivity can take up to a minute.)
- **Mobile app (Android):** https://expo.dev/accounts/adkim2303/projects/food-label-reader-app/builds/67b021ca-3ca4-45eb-b713-a58fb7a937f5  
  Open this link on an Android device to install directly, or scan the QR code on the build page.

## 🚀 How to Run It

### Web App (Node/Express)
Requires Node 20+ and the Tesseract OCR binary (`tesseract-ocr` on Linux, or the [official installer](https://github.com/tesseract-ocr/tesseract) on Windows/Mac).

```bash
npm install
cp .env.example .env   # set MONGODB_URI for accounts/history; app runs without it
npm start
```
`npm start` runs `node src/server.js` (the server file lives in `src/`, not the repo root) and listens on `http://localhost:5000`.

**Or with Docker** (bundles the Tesseract binary automatically):
```bash
docker build -t food-label-reader .
docker run -p 5000:5000 food-label-reader
```

### Notebook (Python/Colab)
1. Open `notebooks/food_label_reader_final.ipynb` in **[Google Colab](https://colab.research.google.com/)**
2. Runtime → Run all
3. When section 9b's login cell runs, either log in / sign up with your web-app account to sync scans there too, or just press Enter to skip and keep everything local-only, like before
4. Upload one or more nutrition label photos (Ctrl/Cmd+click for multiple)

### Mobile App (React Native/Expo)
```bash
cd mobile-app
npm install
npx expo start
```
Point `mobile-app/services/api.js` at your backend URL (local or deployed).

## 🛠️ Tech Stack

**Notebook:** Python, Tesseract OCR (pytesseract), OpenCV, pyzbar, matplotlib, SQLite, reportlab

**Web App backend:** Node.js, Express, Tesseract OCR (`node-tesseract-ocr`), Sharp (image preprocessing), Multer (uploads), zedbar (barcode scanning), MongoDB/Mongoose, JWT + bcrypt, OpenFoodFacts API

**Web App frontend:** Vanilla HTML/CSS/JS (`index.html`)

**Mobile App:** React Native, Expo, React Navigation, Expo Image Picker

## 📊 Accuracy & Testing

Testing follows a **train/held-out split**, specifically to avoid overstating accuracy from tuning against the same photos used to measure it:

| Set | Photos | Purpose | Overall field accuracy | 95% bootstrap CI |
|---|---|---|---|---|
| **Dev set** | 15 | Used to build and tune the parser | **61.3%** (95/155 fields) | 43.9%–77.6% |
| **Held-out set** | 8 | Never used during development | **63.1%** (53/84 fields) | 38.1%–85.7% |

Both sets have hand-typed ground truth (`tests/real_ground_truth.csv`, `tests/held_out_ground_truth.csv`), the source photos are bundled in the repo (`tests/label_photos/dev/`, `tests/label_photos/held_out/`), and both were evaluated with `tests/evaluate_accuracy.py`, which reports field-level accuracy, mean absolute error, and allergen precision/recall — see `tests/accuracy_report.md` and `tests/held_out_report/accuracy_report.md` for the full breakdown per nutrient, plus `tests/failure_cases.csv` for every individual failure logged with expected vs. predicted values.

<details>
<summary><b>Dev set — 15 photos</b> (<code>tests/label_photos/dev/</code>)</summary>

protein_jerky_bag.jpg, cheetos_crunchy.jpg, lucerne_liquid_egg_whites.jpg, costco_organic_granny_smith_apple_chips.jpg, unidentified_yellow_box_product.jpg, green_box_veggie_protein_product.jpg, jenis_ice_cream_double_dough.jpg, savoritz_parmesan_crisps.jpg, bread_nutrition_label_generic.jpg, dr_praegers_california_veggie_burger.jpg, cucumber_avocado_tomato_salad_nutrition.jpg, trader_joes_kung_pao_chicken.jpg, trader_joes_sea_salted_potato_crisps.jpg, whole_wheat_pasta_kroger.jpg, almonds_nutrition_label.jpg

</details>

<details>
<summary><b>Held-out set — 8 photos</b> (<code>tests/label_photos/held_out/</code>)</summary>

zero_brands_strawberry_cream_bars.jpg, choceur_peanuts_cornflakes_bar.jpg, deutsche_kuche_triple_chocolate_muesli.jpg, goodnessknows_apple_almond_peanut_bar.jpg, generic_chocolate_squares.jpg, lucky_charms_cereal.jpg, bear_naked_sweet_honey_clusters.jpg, Annie_s_protein_nutritional.jpg

</details>

**Allergen detection:** 100% precision on both sets (no false positives), recall of 50% (dev, 2/4) and 11% (held-out, 1/9) — limited mainly by ingredient lists not being visible in some photo crops, not by the keyword logic itself. See failure cases for specifics.

**Additional exploratory sets** cover a wider variety of real-world photos and are reported separately in their own `*_report/` folders. These are extra signal only — smaller/more variable, and not all of them ship with their source photos:

| Set | Photos in repo? | Field accuracy | Allergen precision/recall |
|---|---|---|---|
| `batch3` (7 photos) | Yes — `tests/label_photos/batch3/` | 86.4% (57/66) | n/a (no allergens in this set) |
| `web_sourced` (16 photos) | No — ground truth CSV only | 78.5% (124/158) | 100% / 100% (5/5) |
| `web_real` (20 photos) | No — ground truth CSV only | 25.9% (53/205) | 100% / 20% (5/25) |
| `web_real2` (20 photos) | No — ground truth CSV only | 31.1% (56/180) | 100% / 19% (5/26) |

<details>
<summary><b>batch3 — 7 photos</b> (bundled, <code>tests/label_photos/batch3/</code>)</summary>

six_food_shopping_mistakes_cereal.jpg, worst_chemicals_fiber_cereal_cropped.jpg, nantucket_dark_chocolate_cookie.jpg, costco_kirkland_smoked_pulled_pork.jpg, kroger_candy_pack.jpg, bariatricpal_protein_power_shot.jpg, trader_joes_ginger_bread_granola.jpg

</details>

<details>
<summary><b>web_sourced — 16 photos</b> (ground truth only, no photos bundled)</summary>

betty_crocker_pink_cake_icing.jpg, bobs_red_mill_flaxseed_meal.jpg, brownberry_12_grain_bread.jpg, califia_barista_almondmilk.jpg, cheez_it_sweet_salty_snack_mix.jpg, horizon_organic_mexican_cheese.jpg, junior_caramels.jpg, lays_dill_pickle.jpg, natures_own_whole_grain_bread.jpg, popchips_ridges_cheddar_sour_cream.jpg, sour_patch_kids.jpg, stacys_cinnamon_sugar_pita_chips.jpg, sweetarts_mini_chewy.jpg, teas_tea_fuji_apple_black_tea.jpg, tennessee_pride_sausage_biscuits.jpg, wegmans_pepperoni_pizza.jpg

</details>

<details>
<summary><b>web_real — 20 photos</b> (ground truth only, no photos bundled)</summary>

creamy_mac_and_cheese.jpg, stew_leonards_garlic_bread.jpg, trader_joes_big_soft_pretzels.jpg, trader_joes_black_tiger_shrimp.jpg, trader_joes_buttermilk_brined_half_chicken.jpg, trader_joes_butternut_squash_triangoli.jpg, trader_joes_cinnamon_bun_pancake_mix.jpg, trader_joes_everything_bagel_smoked_salmon.jpg, trader_joes_mashed_cauliflower.jpg, trader_joes_mozzarella_low_moisture.jpg, trader_joes_no_sugar_uncured_bacon.jpg, trader_joes_organic_mango_lemonade.jpg, trader_joes_peanut_butter_blondies.jpg, trader_joes_pumpkin_cream_cheese_spread.jpg, trader_joes_rolled_corn_tortilla_chips.jpg, trader_joes_speculoos_cookie_butter.jpg, trader_joes_sweet_corn_burrata_ravioli.jpg, trader_joes_thai_coconut_chicken_kabobs.jpg, trader_joes_unexpected_cheddar_spread.jpg, trader_joes_vegan_jackfruit_cakes.jpg

</details>

<details>
<summary><b>web_real2 — 20 photos</b> (ground truth only, no photos bundled)</summary>

cheddar_bacon_egg_bites.jpg, trader_joes_agua_fresca.jpg, trader_joes_apple_cider_cookies.jpg, trader_joes_battered_halibut.jpg, trader_joes_brownie_crisps.jpg, trader_joes_caesar_style_salad.jpg, trader_joes_carnival_fun_cake_fries.jpg, trader_joes_chocolate_cara_cara_caramels.jpg, trader_joes_chunky_blue_cheese_dressing.jpg, trader_joes_cilantro_salad_dressing.jpg, trader_joes_goat_cheese_sundried_tomato.jpg, trader_joes_hot_smoked_scottish_salmon.jpg, trader_joes_light_ice_cream.jpg, trader_joes_limone_alfredo_sauce.jpg, trader_joes_pimento_cheese_dip.jpg, trader_joes_rose_wine_pink_peppercorn_salt.jpg, trader_joes_salmon_bacon.jpg, trader_joes_speculoos_cookies.jpg, trader_joes_watermelon_cucumber_cooler.jpg, unidentified_two_column_product.jpg

</details>

Reproducing the `web_real`/`web_real2`/`web_sourced` numbers from scratch requires the original source photos, which aren't checked into this repository — only their ground-truth CSVs and pre-computed `*_report/` outputs are. `batch3`'s photos, however, **are** bundled, so that set can be re-run directly.

**Test suites:** 56 Python unit tests (`pytest tests/test_nutrition_parser.py`) + 60 JavaScript unit tests (`npm test`), covering parsing, health scoring (including 4 worked examples from the official FSA/Ofcom model spec), diet compatibility, and known OCR-correction edge cases.

**Robustness testing:** `tests/test_robustness.py` synthetically blurs, rotates, and crops a clean photo to measure extraction degradation at known severities — see `tests/robustness_report/` for results.

## 🧮 Health Scoring

Two scores are available, side by side, deliberately:

1. **Custom heuristic score (0–100).** Starts at 100, penalizes saturated fat/sugar/sodium above 20% of daily value, NOVA processing group, Nutri-Score grade, additive count, and trans fat. Documented inline in `src/nutrition_parser.py` / `src/nutritionParser.js` with every weight's rationale. **This is this project's own design, not a peer-reviewed standard** — stated plainly rather than implied otherwise.
2. **FSA/Ofcom Nutrient Profiling Model score.** The real, published model the UK Food Standards Agency/Ofcom developed in 2004–2005, still used today to legally restrict advertising of "less healthy" food to children. Implemented in `calculate_fsa_npm_score()` (Python) and validated against **all of the official technical guidance's worked examples** (0, 12, 5, 6 — reproduced exactly; see `TestFsaNpmScore` in the test suite). Requires a parseable serving size in grams to convert per-serving values to the model's required per-100g basis; returns `None` rather than guessing when that isn't possible. Source: *Nutrient Profiling Technical Guidance*, UK Department of Health, Jan 2011.

## 🥗 Diet Compatibility

Vegan, vegetarian, keto, halal/kosher, paleo, and low-FODMAP checks are **ingredient-keyword screening**, not certified/audited compatibility — stated directly here and in each function's docstring:

- **Vegan/vegetarian:** keyword list sourced from [The Vegan Society's definition](https://www.vegansociety.com/go-vegan/definition-veganism).
- **Keto:** primarily **numeric** — net carbs (total carbs − fiber) ≤10g per serving, a common app/community rule-of-thumb (not a single official clinical threshold, since real ketogenic guidance targets ~20–50g net carbs *per day*, not per serving).
- **Paleo:** keyword list based on Loren Cordain's original defining framework.
- **Low-FODMAP:** keyword list sourced from [Monash University's published label-reading guidance](https://www.monashfodmap.com/blog/update-label-reading/) (the university that defined the FODMAP framework), including the specific polyol E-numbers their own guidance flags.
- **Halal/kosher:** returns **two tiers**, not one yes/no — `definiteConflicts` (pork, alcohol, blood — essentially always non-compliant) and `uncertainIngredients` (gelatin, rennet, mono/diglycerides — compliance depends on unlisted supply-chain sourcing that no printed ingredient list discloses). This is a structural limit, not a bug: even published halal ingredient guides say things like "if derived from a halal-slaughtered animal, then halal" about gelatin — i.e. the ingredient *name* alone is genuinely insufficient, for anyone.

## ⚠️ Known Limitations

- **Two-column labels** ("Per Serving | Per Container" side by side) are hard. Five different fixes were attempted (fuzzy keyword-correction, relaxed OCR-noise tolerance, value-position column clustering, a rejected CLAHE-contrast experiment, and FDA-mandated-field-order positional inference) — together they raised held-out accuracy from 46.4% to 63.1% and correctly parse several real two-column photos, but two specific severely-degraded test photos still fail: their OCR corruption destroys not just the nutrient keyword but the digit/unit markers too, leaving no reliable signal for any text-based technique to anchor to. This needs better source-photo quality, not more parsing logic.
- OCR accuracy depends heavily on photo quality (lighting, blur, angle, crop).
- Diet-compatibility checks are keyword-based (see above) — not a substitute for certified halal/kosher/vegan/low-FODMAP verification.
- The custom health score is a documented heuristic, not a clinically validated standard (the FSA/Ofcom score above is the closer thing to one).
- Nutri-Score/Eco-Score/NOVA only appear when a barcode is visible **and** the product is registered on OpenFoodFacts.
- The exploratory `web_real`/`web_real2`/`web_sourced` photo sets are not bundled with this repository (only their ground-truth CSVs and pre-computed reports are) — reproducing those specific numbers requires the source photos. `batch3`'s photos, by contrast, are bundled and can be re-run directly.

---

<div align="center">

⭐ **If you found this project useful, consider giving it a star!**

</div>
