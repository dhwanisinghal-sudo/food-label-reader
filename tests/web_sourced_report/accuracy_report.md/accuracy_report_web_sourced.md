# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 16
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 0
Flagged as low OCR confidence (<60 avg): 0

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 16 | 13 | 2 | 1 | 81.2% | 0.31 |
| total_fat_g | 16 | 14 | 0 | 2 | 87.5% | 0.00 |
| saturated_fat_g | 14 | 12 | 0 | 2 | 85.7% | 0.12 |
| trans_fat_g | 14 | 11 | 0 | 3 | 78.6% | 0.00 |
| cholesterol_mg | 12 | 9 | 0 | 3 | 75.0% | 0.00 |
| sodium_mg | 16 | 13 | 1 | 2 | 81.2% | 0.00 |
| total_carbs_g | 15 | 10 | 1 | 4 | 66.7% | 0.00 |
| fiber_g | 10 | 7 | 3 | 0 | 70.0% | 0.00 |
| total_sugars_g | 16 | 15 | 1 | 0 | 93.8% | 0.00 |
| added_sugars_g | 13 | 8 | 0 | 5 | 61.5% | 0.00 |
| protein_g | 16 | 12 | 2 | 2 | 75.0% | 0.00 |

**Overall field accuracy: 124/158 = 78.5%**

## Sample-size caveat

This is a **16-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 78.5%, but resampling the photos gives a 95% bootstrap interval of **68.6% - 87.7%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 5, False positives: 0, False negatives: 0
Precision: 100.0% | Recall: 100.0% | F1: 100.0%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **36** values across 16 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **7** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 16 evaluated photos.

## Failure cases: 34 logged -> see failure_cases.csv
