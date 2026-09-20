# OCR + Nutrition Parsing Accuracy Report

Images evaluated: 7
Flagged as low quality (blur/dark/overexposed) by check_image_quality: 0
Flagged as low OCR confidence (<60 avg): 1

## Field-level accuracy (numeric fields)

| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |
|---|---|---|---|---|---|---|
| calories | 7 | 5 | 1 | 1 | 71.4% | 0.00 |
| total_fat_g | 7 | 5 | 1 | 1 | 71.4% | 0.00 |
| saturated_fat_g | 7 | 7 | 0 | 0 | 100.0% | 0.01 |
| trans_fat_g | 7 | 4 | 0 | 3 | 57.1% | 0.00 |
| cholesterol_mg | 5 | 5 | 0 | 0 | 100.0% | 0.00 |
| sodium_mg | 6 | 6 | 0 | 0 | 100.0% | 0.00 |
| total_carbs_g | 5 | 5 | 0 | 0 | 100.0% | 0.00 |
| fiber_g | 6 | 6 | 0 | 0 | 100.0% | 0.00 |
| total_sugars_g | 6 | 6 | 0 | 0 | 100.0% | 0.00 |
| added_sugars_g | 4 | 4 | 0 | 0 | 100.0% | 0.00 |
| protein_g | 6 | 4 | 0 | 2 | 66.7% | 0.00 |

**Overall field accuracy: 57/66 = 86.4%**

## Sample-size caveat

This is a **7-photo** evaluation. Treat it as a directional smoke test, not a benchmark:
- Overall field accuracy is 86.4%, but resampling the photos gives a 95% bootstrap interval of **76.1% - 95.1%**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), so the effective sample is closer to the number of photos than to the number of fields.
- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.
- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.
- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. A held-out set of photos not used during development is the next step.

## Allergen detection

True positives: 0, False positives: 0, False negatives: 0
Precision: nan% | Recall: nan% | F1: nan%

## Automatic OCR value corrections

- Character-substitution fixes (misread O/o/I/l treated as a digit before parsing): **31** values across 7 photos
- %DV cross-check overrides (a parsed value disagreed too strongly with the label's own printed %DV and was replaced by the %DV-derived value): **0** values
- These counts are mechanical corrections applied automatically during parsing, not manual corrections made by a person after the fact. A value that was auto-corrected can still end up WRONG relative to ground truth (see failure_cases.csv) -- these numbers measure how often the mechanism fired, not how often it fired correctly.

## Two-column label handling

- Column detection (`extract_columns_if_present` / `_reconstruct_columns_from_words`) was actually used (i.e. it detected a confident two-column split AND that column recovered more fields than the merged whole-image parse) on **0** of the 7 evaluated photos.

## Failure cases: 9 logged -> see failure_cases.csv
