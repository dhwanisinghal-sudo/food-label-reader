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

| Set | Photos | Purpose | Overall field accuracy |
|---|---|---|---|
| **Dev set** | 15 | Used to build and tune the parser | **63.2%** |
| **Held-out set** | 8 | Never used during development | **63.1%** (95% bootstrap CI: 38%–86%) |

Both sets have hand-typed ground truth (`tests/real_ground_truth.csv`, `tests/held_out_ground_truth.csv`) and were evaluated with `tests/evaluate_accuracy.py`, which reports field-level accuracy, mean absolute error, and allergen precision/recall — see `tests/accuracy_report.md` and `tests/held_out_report/accuracy_report.md` for the full breakdown per nutrient, plus `tests/failure_cases.csv` for every individual failure logged with expected vs. predicted values.

**Allergen detection:** precision 100%, recall 11–75% depending on the set (limited mainly by ingredient lists not being visible in some photo crops, not by the keyword logic itself — see failure cases for specifics).

**Additional exploratory sets** (`tests/label_photos/web_real`, `web_real2`, `web_sourced`, `batch3`) cover a wider variety of real-world photos and are reported separately in their own `*_report/` folders — useful as extra signal, but the dev/held-out numbers above are the primary, hand-verified accuracy claim.

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
- The exploratory `web_real`/`web_real2`/`web_sourced`/`batch3` photo sets are not bundled with this repository (only their ground-truth CSVs and pre-computed reports are) — reproducing those specific numbers requires the source photos.

---

<div align="center">

⭐ **If you found this project useful, consider giving it a star!**

</div>
