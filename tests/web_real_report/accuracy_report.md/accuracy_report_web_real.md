# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 20
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 0
Flagged as low OCR confidence (<60 avg): 14

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 20 | 7 | 4 | 9 | 35.0% | 0.00 |
| total_fat_g | 20 | 5 | 1 | 14 | 25.0% | 0.00 |
| saturated_fat_g | 20 | 5 | 0 | 15 | 25.0% | 0.00 |
| trans_fat_g | 20 | 7 | 0 | 13 | 35.0% | 0.00 |
| cholesterol_mg | 19 | 3 | 0 | 16 | 15.8% | 0.00 |
| sodium_mg | 20 | 2 | 1 | 17 | 10.0% | 0.00 |
| total_carbs_g | 19 | 3 | 0 | 16 | 15.8% | 0.00 |
| fiber_g | 18 | 9 | 2 | 7 | 50.0% | 0.12 |
| total_sugars_g | 19 | 7 | 0 | 12 | 36.8% | 0.00 |
| added_sugars_g | 13 | 1 | 0 | 12 | 7.7% | 0.00 |
| protein_g | 17 | 4 | 1 | 12 | 23.5% | 0.00 |

**Overall field accuracy: 53/205 = 25.9%**

## Sample-size caveat

This is a **20-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 25.9%, but resampling the photos gives a 95% bootstrap interval of **15.2% - 38.2%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 5, False positives: 0, False negatives: 20
Precision: 100.0% | Recall: 20.0% | F1: 33.3%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **18** values across 20 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **5** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 20 evaluated photos.

## Failure cases: 162 logged -> see failure_cases.csv
