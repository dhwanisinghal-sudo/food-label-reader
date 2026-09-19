# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 15
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 9
Flagged as low OCR confidence (<60 avg): 7

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 15 | 5 | 1 | 9 | 33.3% | 0.00 |
| total_fat_g | 15 | 2 | 0 | 13 | 13.3% | 0.00 |
| saturated_fat_g | 15 | 5 | 0 | 10 | 33.3% | 0.20 |
| trans_fat_g | 14 | 5 | 0 | 9 | 35.7% | 0.00 |
| cholesterol_mg | 15 | 6 | 0 | 9 | 40.0% | 0.00 |
| sodium_mg | 15 | 3 | 2 | 10 | 20.0% | 0.00 |
| total_carbs_g | 15 | 4 | 0 | 11 | 26.7% | 0.00 |
| fiber_g | 14 | 5 | 0 | 9 | 35.7% | 0.10 |
| total_sugars_g | 14 | 1 | 1 | 12 | 7.1% | 0.00 |
| protein_g | 15 | 3 | 0 | 12 | 20.0% | 0.00 |

**Overall field accuracy: 39/147 = 26.5%**

## Allergen detection

True positives: 0, False positives: 1, False negatives: 5
Precision: 0.0% | Recall: 0.0% | F1: nan%

## Failure cases: 113 logged -> see failure_cases.csv
