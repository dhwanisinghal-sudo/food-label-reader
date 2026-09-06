# 🥗 Food Label Reader

Extracts nutrition information from food label photos using OCR, flags unhealthy sugar/sodium/fat levels based on FDA daily-value guidelines, and enriches results with data from OpenFoodFacts (Nutri-Score, NOVA processing group, Eco-Score).

Internship project exploring OCR, text parsing, and automated health insights — now available as a **web app**, a **native Android app**, and the original **research notebook**, all backed by one shared server.

## What it does

- **OCR extraction** — reads nutrition facts panels from photos (Tesseract, with preprocessing: deskew, contrast enhancement, quality checks)
- **Nutrition parsing** — pulls out calories, fat, sodium, carbs, sugar, protein, fiber, cholesterol, **and micronutrients (Vitamin D, Calcium, Iron, Potassium)**
- **Age/life-stage-aware Daily Values** — %DV and health scoring can be calculated against the FDA's official reference values for **Adults/Children 4+**, **Toddlers (1–3 yrs)**, or **Pregnant/Lactating** individuals (21 CFR 101.9), not just one fixed adult baseline
- **Health scoring** — 0–100 composite score with an Excellent/Good/Moderate/Poor rating and a line-by-line breakdown of what raised or lowered it
- **Ingredient intelligence** — detects allergens (milk, soy, nuts, gluten, etc.), additives (artificial colors, sweeteners, preservatives, hydrogenated oils, flavor enhancers) **with a plain-language note on what each one is and why it matters**, and diet compatibility (vegan, keto, halal/kosher, paleo, low-FODMAP)
- **Barcode + OpenFoodFacts lookup** — scans barcodes/QR codes in the photo and fetches Nutri-Score, Eco-Score, and NOVA processing group for the product
- **Personalized health flags** — alerts based on a selected health profile (diabetes, high blood pressure, high cholesterol, heart disease, kidney disease, weight management, pregnancy, and common allergies/intolerances)
- **Accounts + scan history** — sign up, log in, and revisit past scans (MongoDB Atlas)

## How to use it

### Web app
Live at the deployed backend's root URL — open it in any browser, sign up, and start scanning. No install needed.

### Mobile app (Android)
A native React Native/Expo app lives in [`mobile-app/`](./mobile-app), built against the same backend — same accounts, same scan history. See [`mobile-app/README.md`](./mobile-app/README.md) for setup and build instructions.

### Backend
```
cd src
npm install
node server.js
```
Requires a `.env` with `MONGODB_URI` and `JWT_SECRET`. Serves both the API (`/api/*`) and the web frontend (`index.html`).

### Original research notebook
1. Open `notebooks/food_label_reader_final.ipynb` in [Google Colab](https://colab.research.google.com/)
2. **Runtime → Run all**
3. When prompted, upload one or more nutrition label photos (Ctrl/Cmd+click to select multiple)
4. Each image's report — nutrition breakdown, health score, insights, and charts — prints automatically

No API key needed for either the app or the notebook. OpenFoodFacts lookups only run if a barcode is detected in the photo.

## Known limitations

- OCR accuracy depends heavily on photo quality (lighting, blur, angle)
- Nutri-Score/Eco-Score/NOVA data only appears if a barcode is visible **and** the product is registered on OpenFoodFacts
- Ingredient parsing works best on labels with a clearly printed "Ingredients:" section
- OCR misreads (e.g. `0`↔`O`, `g`↔digit confusion) are corrected using a %DV cross-check against the label's own printed daily-value percentages, but this isn't foolproof on noisy photos

## Tech stack

**Backend:** Node.js + Express, MongoDB Atlas (Mongoose), JWT + bcrypt auth, Tesseract OCR (`node-tesseract-ocr`), Sharp (image preprocessing), zedbar (barcode/QR decoding), OpenFoodFacts API
**Web frontend:** HTML/CSS/JavaScript
**Mobile app:** React Native (Expo), React Navigation, Axios
**Hosting:** Render (backend + web app)
**Original notebook:** Python, Tesseract OCR, OpenCV, pyzbar, matplotlib, SQLite, reportlab

## Tested on

11+ real product photos across varying quality conditions, plus live end-to-end testing of the deployed web app, backend API, and mobile app on Android.

## Project structure

```
src/            Backend — Express server, OCR/nutrition parsing, auth, OpenFoodFacts
models/         MongoDB schemas (User, ScanHistory)
mobile-app/     React Native (Expo) Android app
notebooks/      Original Colab research notebook
tests/          Parser tests
index.html      Web frontend
```
