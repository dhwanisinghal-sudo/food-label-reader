# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 15
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 1
Flagged as low OCR confidence (<60 avg): 4

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 15 | 13 | 0 | 2 | 86.7% | 0.00 |
| total_fat_g | 15 | 10 | 0 | 5 | 66.7% | 0.00 |
| saturated_fat_g | 15 | 9 | 1 | 5 | 60.0% | 0.00 |
| trans_fat_g | 15 | 7 | 0 | 8 | 46.7% | 0.00 |
| cholesterol_mg | 15 | 9 | 0 | 6 | 60.0% | 0.00 |
| sodium_mg | 15 | 10 | 1 | 4 | 66.7% | 0.00 |
| total_carbs_g | 15 | 8 | 0 | 7 | 53.3% | 0.00 |
| fiber_g | 14 | 7 | 0 | 7 | 50.0% | 0.08 |
| total_sugars_g | 14 | 9 | 0 | 5 | 64.3% | 0.00 |
| added_sugars_g | 8 | 2 | 0 | 6 | 25.0% | 0.00 |
| protein_g | 14 | 9 | 0 | 5 | 64.3% | 0.00 |

**Overall field accuracy: 93/155 = 60.0%**

## Allergen detection

True positives: 1, False positives: 0, False negatives: 3
Precision: 100.0% | Recall: 25.0% | F1: 40.0%

## Failure cases: 65 logged -> see failure_cases.csv
