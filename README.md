<div align="center">

# 🥗 Food Label Reader

### OCR-powered nutrition label scanner with health scoring & diet intelligence

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tesseract OCR](https://img.shields.io/badge/Tesseract-OCR-4285F4?style=for-the-badge&logo=googlelens&logoColor=white)](https://github.com/tesseract-ocr/tesseract)
[![OpenFoodFacts](https://img.shields.io/badge/OpenFoodFacts-API-00AA55?style=for-the-badge&logo=googlemaps&logoColor=white)](https://world.openfoodfacts.org/)

**Snap a photo of a nutrition label — get a full health breakdown, allergen flags, and diet compatibility in seconds.**

*Internship project exploring OCR, text parsing, and automated health insights.*

[What It Does](#-what-it-does) • [How to Run](#-how-to-run-it) • [Tech Stack](#%EF%B8%8F-tech-stack) • [Limitations](#-known-limitations) • [Tested On](#-tested-on)

</div>

---

## 🧾 Overview

Food Label Reader turns a photo of any nutrition facts panel into a structured, personalized health report. It reads the label with OCR, cross-checks the numbers, scores the product, flags allergens and additives, and — if a barcode is visible — enriches everything with live data from OpenFoodFacts (Nutri-Score, NOVA group, Eco-Score).

The project exists in **three separate implementations** that were built independently and do **not** share code. Feature support differs between them — see the table below before assuming something works everywhere.

- **`notebooks/food_label_reader_final.ipynb`** — the original Python/Colab prototype
- **Web app** (`index.html` + `src/`) — a Node/Express backend with a browser frontend, deployed at the live link
- **Mobile app** (`mobile-app/`) — a React Native/Expo app that talks to the same backend

## ✨ What It Does

| Feature | Notebook | Web App | Mobile App |
|---|:---:|:---:|:---:|
| OCR extraction (Tesseract) | ✅ | ✅ | ✅ (via backend) |
| Deskew + contrast enhancement (CLAHE) + blur/quality check | ✅ | ❌ *(resize + EXIF rotation only, no deskew/CLAHE)* | ❌ *(uses same backend as web)* |
| Nutrition parsing (calories, fat, sodium, carbs, sugar, protein, fiber, cholesterol, vitamins/minerals) | ✅ | ✅ | ✅ |
| Health score (0–100) | ✅ | ✅ | ✅ |
| Allergen / additive detection | ✅ | ✅ | ✅ |
| Diet compatibility (vegan, keto, halal/kosher, paleo, low-FODMAP) | ✅ *(keyword-matched, not certified/validated)* | ✅ *(same keyword-matching approach)* | ✅ |
| Barcode + OpenFoodFacts lookup | ✅ | ✅ | ✅ |
| Personalized flags from a user profile | ✅ | ✅ | ✅ |
| **Multi-image upload in one go** | ✅ | ❌ *(one image at a time — see [Known Limitations](#-known-limitations))* | ❌ |
| Export to JSON/PDF | ✅ | Partial (JSON via API response) | ❌ |
| Scan history | SQLite (local, notebook session only) | MongoDB (per logged-in account, via `/api/history`) | Reads the same MongoDB history via the backend |
| Accounts / login | ❌ | ✅ (email+password, JWT) | ✅ |

> The web app and mobile app share one Node/Express backend (`src/server.js`), so their feature set is effectively identical — the difference is just the client UI.

## 🚀 How to Run It

### Notebook (Python/Colab)
1. Open `notebooks/food_label_reader_final.ipynb` in **[Google Colab](https://colab.research.google.com/)**
2. Click **Runtime → Run all**
3. When prompted, upload one or more nutrition label photos *(Ctrl/Cmd+click to select multiple)*
4. Each image's report — nutrition breakdown, health score, insights, and charts — prints automatically

No API key needed. OpenFoodFacts lookups only run when a barcode is detected in the photo.

### Web App (Node/Express)
Requires Node 20+ and the Tesseract OCR binary installed on your system (`tesseract-ocr` package on Linux, or the [official installer](https://github.com/tesseract-ocr/tesseract) on Windows/Mac).

```bash
npm install
cp .env.example .env   # set MONGODB_URI if you want accounts/history; the app runs without it, just with signup/login/history disabled
npm start
```

The server listens on `http://localhost:5000` by default (`PORT` env var to change it) and serves `index.html` at `/`.

**Or with Docker** (bundles the Tesseract binary automatically):
```bash
docker build -t food-label-reader .
docker run -p 5000:5000 food-label-reader
```

**Live deployment:** the hosted version is at the link in the submission email.

### Mobile App (React Native/Expo)
```bash
cd mobile-app
npm install
npx expo start
```
Scan the QR code with the Expo Go app, or run `npm run android` / `npm run ios` for an emulator. The app expects the backend URL to be set in `mobile-app/services/api.js` — point it at your local server or the deployed one.

A pre-built APK is also available via the link in the submission email — installing it requires allowing "install from unknown sources" on Android.

## 🛠️ Tech Stack

**Notebook:** Python, Tesseract OCR, OpenCV, pyzbar, matplotlib, SQLite, reportlab

**Web App backend:** Node.js, Express, Tesseract OCR (via `node-tesseract-ocr`), Sharp (image preprocessing), Multer (uploads), zedbar (barcode scanning), MongoDB/Mongoose (accounts + history), JWT + bcrypt (auth), OpenFoodFacts API

**Web App frontend:** Vanilla HTML/CSS/JS (`index.html`)

**Mobile App:** React Native, Expo, React Navigation, Expo Image Picker

## ⚠️ Known Limitations

- **The web app does not currently support multi-image upload** — only the notebook does. This is listed here explicitly because an earlier version of this README implied it worked everywhere.
- **The web app's image preprocessing is simpler than the notebook's** — it resizes and corrects EXIF rotation, but does not deskew or apply CLAHE contrast enhancement the way the notebook does.
- OCR accuracy depends heavily on photo quality (lighting, blur, angle, multi-column layouts).
- Diet-compatibility checks (vegan, keto, halal/kosher, paleo, low-FODMAP) are keyword-matches against the parsed ingredient list — they are **not** validated against certification standards and do not account for cross-contamination or "may contain" disclaimers.
- The health score is a hand-weighted heuristic (see the formula in `src/nutritionParser.js` / the notebook's `calculate_health_score`), not derived from a peer-reviewed nutrient-profiling model. Thresholds and weights are documented inline in code comments but are the author's own judgment calls, not a cited standard.
- Nutri-Score / Eco-Score / NOVA data only appears if a barcode is visible **and** the product is registered on OpenFoodFacts.
- Ingredient parsing works best on labels with a clearly printed "Ingredients:" section.

## 🧪 Tested On

Initial development testing used 11 real product photos (7 nutrition labels, 4 barcodes). This was an informal smoke test, not a validated accuracy benchmark — of those 11 photos, 6 returned no extractable nutrition data at all.

A proper accuracy evaluation — a labeled set of product photos with manually-entered ground-truth nutrition values, compared field-by-field against OCR output — is in progress in `label_photos/` and `evaluate_accuracy.py`. *(Once that's run, replace this paragraph with the actual field-level accuracy numbers, extraction success rate, and example failure cases.)*

---

<div align="center">

⭐ **If you found this project useful, consider giving it a star!**

</div>
