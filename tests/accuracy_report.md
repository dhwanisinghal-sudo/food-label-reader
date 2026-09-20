# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 15
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 1
Flagged as low OCR confidence (<60 avg): 5

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 15 | 13 | 0 | 2 | 86.7% | 0.00 |
| total_fat_g | 15 | 10 | 0 | 5 | 66.7% | 0.00 |
| saturated_fat_g | 15 | 10 | 1 | 4 | 66.7% | 0.00 |
| trans_fat_g | 14 | 7 | 0 | 7 | 50.0% | 0.00 |
| cholesterol_mg | 15 | 9 | 0 | 6 | 60.0% | 0.00 |
| sodium_mg | 15 | 10 | 1 | 4 | 66.7% | 0.00 |
| total_carbs_g | 15 | 9 | 0 | 6 | 60.0% | 0.00 |
| fiber_g | 14 | 7 | 0 | 7 | 50.0% | 0.08 |
| total_sugars_g | 14 | 9 | 0 | 5 | 64.3% | 0.00 |
| added_sugars_g | 8 | 2 | 0 | 6 | 25.0% | 0.00 |
| protein_g | 15 | 9 | 0 | 6 | 60.0% | 0.00 |

**Overall field accuracy: 95/155 = 61.3%**

## Sample-size caveat

This is a **15-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 61.3%, but resampling the photos gives a 95% bootstrap interval of **43.9% - 77.6%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 2, False positives: 0, False negatives: 2
Precision: 100.0% | Recall: 50.0% | F1: 66.7%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **22** values across 15 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **6** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 15 evaluated photos.

## Failure cases: 62 logged -> see failure_cases.csv
