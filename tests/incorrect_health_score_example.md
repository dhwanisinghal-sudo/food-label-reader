# Incorrect Health Score — Documented Example

## Product
`unidentified_yellow_box_product_jpg.jpg` (from `tests/real_ground_truth.csv`)

**Ground-truth label values:** 100 calories, 11g total fat, 2g saturated fat, **3g trans fat**,
0mg cholesterol, 100mg sodium, 0g carbs, 0g protein, ~32 servings/container.

## The bug

The original `calculate_health_score()` (both the notebook's Python version and the web
app's JS version) never looked at `trans_fat_g` at all — only saturated fat, sugar, and
sodium were penalized. Trans fat is one of the nutrients WHO/FDA guidance treats as having
**no safe daily intake threshold**, so a label with a meaningful amount of it should score
noticeably worse, not the same as a label with none.

## Before vs. after, run against the real function

```
CURRENT (trans-fat fix applied):       70  "Good"
PRE-FIX simulation (trans fat ignored): 100  "Excellent"
```

(Reproducible: `src/nutrition_parser.py`, `calculate_health_score()`, run against the
ground-truth values above — see `tests/test_nutrition_parser.py::test_trans_fat_now_penalized`
for the automated regression test that locks this in.)

## Why this matters

A product with 3g of trans fat per serving — and roughly 32 servings in the container —
was being labeled **"Excellent"**, the top health band the app can assign, purely because
the scoring formula had a blind spot. This is exactly the kind of failure a system making
health-related flags needs to catch: not just "is the OCR reading the numbers right,"
but "does the scoring formula actually use every number it's given." The fix (a flat
per-gram trans-fat penalty, capped at -30, added alongside the existing %DV-based
penalties) is documented inline in `src/nutrition_parser.py` and mirrored in
`src/nutritionParser.js`.

## What this doesn't fix

This was one specific, discovered gap. It does not mean the formula is now complete or
validated — it's still a hand-weighted heuristic (see the "Known Limitations" section of
the README), and there is no guarantee other blind spots like this one don't still exist
for other nutrients or edge cases that haven't been specifically tested.
