# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 20
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 0
Flagged as low OCR confidence (<60 avg): 14

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 19 | 7 | 2 | 10 | 36.8% | 0.00 |
| total_fat_g | 19 | 7 | 1 | 11 | 36.8% | 0.00 |
| saturated_fat_g | 17 | 2 | 0 | 15 | 11.8% | 0.00 |
| trans_fat_g | 17 | 8 | 0 | 9 | 47.1% | 0.00 |
| cholesterol_mg | 17 | 5 | 0 | 12 | 29.4% | 0.00 |
| sodium_mg | 19 | 5 | 1 | 13 | 26.3% | 0.00 |
| total_carbs_g | 18 | 4 | 0 | 14 | 22.2% | 0.00 |
| fiber_g | 12 | 6 | 0 | 6 | 50.0% | 0.00 |
| total_sugars_g | 16 | 6 | 1 | 9 | 37.5% | 0.00 |
| added_sugars_g | 7 | 1 | 0 | 6 | 14.3% | 0.00 |
| protein_g | 19 | 5 | 0 | 14 | 26.3% | 0.00 |

**Overall field accuracy: 56/180 = 31.1%**

## Sample-size caveat

This is a **20-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 31.1%, but resampling the photos gives a 95% bootstrap interval of **18.2% - 44.9%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 5, False positives: 0, False negatives: 21
Precision: 100.0% | Recall: 19.2% | F1: 32.3%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **17** values across 20 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **1** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 20 evaluated photos.

## Failure cases: 134 logged -> see failure_cases.csv
