<div align="center">

# 🥗 Food Label Reader

### OCR-powered nutrition label scanner with health scoring & diet intelligence

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Tesseract OCR](https://img.shields.io/badge/Tesseract-OCR-4285F4?style=for-the-badge&logo=googlelens&logoColor=white)](https://github.com/tesseract-ocr/tesseract)
[![OpenCV](https://img.shields.io/badge/OpenCV-Image%20Processing-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)](https://opencv.org/)
[![OpenFoodFacts](https://img.shields.io/badge/OpenFoodFacts-API-00AA55?style=for-the-badge&logo=googlemaps&logoColor=white)](https://world.openfoodfacts.org/)

**Snap a photo of a nutrition label — get a full health breakdown, allergen flags, and diet compatibility in seconds.**

*Internship project exploring OCR, text parsing, and automated health insights.*

[What It Does](#-what-it-does) • [How to Run](#-how-to-run-it) • [Tech Stack](#%EF%B8%8F-tech-stack) • [Limitations](#-known-limitations) • [Tested On](#-tested-on)

</div>

---

## 🧾 Overview

Food Label Reader turns a photo of any nutrition facts panel into a structured, personalized health report. It reads the label with OCR, cross-checks the numbers, scores the product, flags allergens and additives, and — if a barcode is visible — enriches everything with live data from OpenFoodFacts (Nutri-Score, NOVA group, Eco-Score).

## ✨ What It Does

| | |
|---|---|
| 🔍 **OCR Extraction** | Reads nutrition panels from photos using Tesseract, with deskew, contrast enhancement & quality checks |
| 🧮 **Nutrition Parsing** | Pulls calories, fat, sodium, carbs, sugar, protein, fiber, cholesterol, vitamins & minerals |
| 🏆 **Health Scoring** | 0–100 composite score based on WHO/FDA daily value thresholds |
| ⚠️ **Ingredient Intelligence** | Flags allergens (milk, soy, nuts, gluten…), additives, artificial sweeteners |
| 🥗 **Diet Compatibility** | Checks fit for vegan, keto, halal/kosher, paleo, low-FODMAP diets |
| 📷 **Barcode Lookup** | Scans barcodes and pulls Nutri-Score, Eco-Score & NOVA group from OpenFoodFacts |
| 🎯 **Personalized Flags** | Custom alerts based on a user profile (diabetic, hypertensive, allergies, fitness goals) |
| 🖼️ **Multi-Image Support** | Upload several labels at once — each gets its own report and charts |
| 📤 **Export** | Save results as JSON/PDF; scan history logged to a local SQLite database |

## 🚀 How to Run It

1. Open `food_label_reader_final.ipynb` in **[Google Colab](https://colab.research.google.com/)**
2. Click **Runtime → Run all**
3. When prompted, upload one or more nutrition label photos *(Ctrl/Cmd+click to select multiple)*
4. Each image's report — nutrition breakdown, health score, insights, and charts — prints automatically

> No API key needed. OpenFoodFacts lookups only run when a barcode is detected in the photo.

## 🛠️ Tech Stack

- **Language:** Python
- **OCR:** Tesseract OCR
- **Image Processing:** OpenCV
- **Barcode Scanning:** pyzbar
- **External Data:** OpenFoodFacts API
- **Visualization:** matplotlib
- **Storage:** SQLite
- **PDF Export:** reportlab

## ⚠️ Known Limitations

- OCR accuracy depends heavily on photo quality (lighting, blur, angle) — the notebook warns you before processing an unsuitable photo
- Nutri-Score / Eco-Score / NOVA data only appears if a barcode is visible **and** the product is registered on OpenFoodFacts
- Ingredient parsing works best on labels with a clearly printed "Ingredients:" section

## 🧪 Tested On

Tested against **11 real product photos** (7 nutrition labels, 4 barcodes) across varying quality conditions. OCR misreads (e.g. `0`↔`O`, `g`↔digit confusion) are corrected using a %DV cross-check against the label's own printed daily-value percentages.

---

<div align="center">

⭐ **If you found this project useful, consider giving it a star!**

</div>
