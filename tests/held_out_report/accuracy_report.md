# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 8
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 1
Flagged as low OCR confidence (<60 avg): 3

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 8 | 8 | 0 | 0 | 100.0% | 0.00 |
| total_fat_g | 8 | 3 | 1 | 4 | 37.5% | 0.03 |
| saturated_fat_g | 8 | 6 | 0 | 2 | 75.0% | 0.15 |
| trans_fat_g | 8 | 3 | 0 | 5 | 37.5% | 0.00 |
| cholesterol_mg | 8 | 4 | 0 | 4 | 50.0% | 0.00 |
| sodium_mg | 8 | 5 | 0 | 3 | 62.5% | 0.00 |
| total_carbs_g | 8 | 5 | 0 | 3 | 62.5% | 0.00 |
| fiber_g | 7 | 4 | 1 | 2 | 57.1% | 0.10 |
| total_sugars_g | 8 | 5 | 0 | 3 | 62.5% | 0.00 |
| added_sugars_g | 5 | 2 | 0 | 3 | 40.0% | 0.00 |
| protein_g | 8 | 5 | 0 | 3 | 62.5% | 0.00 |

**Overall field accuracy: 50/84 = 59.5%**

## Sample-size caveat

This is a **8-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 59.5%, but resampling the photos gives a 95% bootstrap interval of **35.7% - 81.4%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 1, False positives: 0, False negatives: 8
Precision: 100.0% | Recall: 11.1% | F1: 20.0%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **7** values across 8 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **2** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 8 evaluated photos.

## Failure cases: 37 logged -> see failure_cases.csv
