"""
evaluate_accuracy.py

Runs the REAL pipeline (image quality check -> deskew -> OCR -> parse_nutrition
-> parse_ingredients -> detect_allergens) against a ground-truth CSV you've
manually filled in, and produces the numbers your internship report is
currently missing:

  - Per-field extraction + accuracy (calories, sodium, sugar, fat, etc.)
  - Mean absolute error for numeric fields (how far off, not just right/wrong)
  - Allergen detection precision / recall / F1
  - A failure_cases.csv listing every single mismatch, with the raw OCR text,
    so you can paste real examples into your report's "failure cases" section

Usage:
    python evaluate_accuracy.py --images_dir ./label_photos --ground_truth ground_truth.csv --out_dir ./report

How to fill ground_truth.csv:
    1. Take clear photos of real labels, put them in one folder.
    2. Manually (by eye) transcribe the true values into a copy of
       ground_truth_template.csv -- one row per photo, filename must match
       exactly (case-sensitive).
    3. Leave a numeric field BLANK if that nutrient genuinely isn't printed
       on that particular label (don't put 0 -- 0 means "confirmed zero").
    4. allergens_true is a semicolon-separated list using the same category
       names as ALLERGEN_KEYWORDS in nutrition_parser.py, e.g.
       "Milk/Dairy;Wheat/Gluten;Egg". Leave blank if none.

Tolerance: a numeric field counts as "correct" if it's within 5% (or 1 unit
for small values, whichever is bigger) of the ground truth, to allow for
rounding -- not for genuine misreads.
"""

import argparse
import csv
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# nutrition_parser.py lives in src/, this script lives in tests/ -- add both
# the script's own folder and the sibling src/ folder so this runs no matter
# which of those two you invoke it from.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))
from nutrition_parser import (
    check_image_quality, deskew_image, extract_text_best_effort,
    detect_allergens_full,
)

NUMERIC_FIELDS = [
    'calories', 'total_fat_g', 'saturated_fat_g', 'trans_fat_g', 'cholesterol_mg',
    'sodium_mg', 'total_carbs_g', 'fiber_g', 'total_sugars_g', 'added_sugars_g', 'protein_g',
]


def is_close(pred, true, rel_tol=0.05, abs_tol=1.0):
    return abs(pred - true) <= max(abs_tol, abs(true) * rel_tol)


def load_ground_truth(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if row['filename'].startswith('EXAMPLE_'):
                continue  # skip the template's example rows
            rows.append(row)
    return rows


def bootstrap_ci_over_images(per_image, n_boot=5000, seed=0):
    """95% bootstrap confidence interval for overall field accuracy, resampling
    IMAGES (not individual fields). Fields within one photo are strongly
    correlated -- a blurry photo fails on nearly every field at once -- so
    treating 150 fields as 150 independent trials would make the number look
    far more certain than it is. per_image = list of (expected, correct)."""
    per_image = [(e, c) for e, c in per_image if e > 0]
    if len(per_image) < 2:
        return None
    rng = random.Random(seed)
    stats = []
    for _ in range(n_boot):
        sample = [per_image[rng.randrange(len(per_image))] for _ in per_image]
        exp = sum(e for e, _ in sample)
        stats.append(sum(c for _, c in sample) / exp if exp else 0.0)
    stats.sort()
    return stats[int(0.025 * n_boot)], stats[int(0.975 * n_boot) - 1]


def evaluate(images_dir, ground_truth_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    gt_rows = load_ground_truth(ground_truth_path)
    if not gt_rows:
        print("No real rows found in the ground-truth CSV (only EXAMPLE_ rows, or file is empty).")
        print("Add real photos + manually transcribed rows before running this.")
        return

    field_stats = {f: {'expected': 0, 'correct': 0, 'wrong': 0, 'missing': 0, 'abs_errors': []} for f in NUMERIC_FIELDS}
    allergen_tp, allergen_fp, allergen_fn = 0, 0, 0
    quality_flagged = 0
    ocr_low_confidence = 0
    failure_cases = []
    per_image_counts = []  # (expected, correct) per evaluated photo, for the bootstrap CI

    for row in gt_rows:
        fname = row['filename']
        img_path = os.path.join(images_dir, fname)
        if not os.path.exists(img_path):
            print(f"[SKIP] {fname}: not found in {images_dir}")
            continue

        quality = check_image_quality(img_path)
        if not quality['ok']:
            quality_flagged += 1

        working_path = deskew_image(img_path, output_path=os.path.join(out_dir, f"_deskewed_{fname}"))
        ocr = extract_text_best_effort(working_path)
        if not ocr['reliable']:
            ocr_low_confidence += 1

        predicted = ocr['nutrition']
        predicted_ingredients = ocr['ingredients']
        # FIX: allergens are now also pulled from the label's own "Contains:"
        # statement, not just inferred from the ingredient list -- see
        # detect_allergens_full()'s docstring. "May contain:" stays out of
        # the precision/recall count below since it's precautionary, not a
        # definite allergen the ground truth column represents.
        allergen_result = detect_allergens_full(ocr['text'], predicted_ingredients)
        predicted_allergens = set(allergen_result['confirmed'].keys())
        true_allergens = set(a.strip() for a in row.get('allergens_true', '').split(';') if a.strip())

        # --- numeric fields ---
        img_expected, img_correct = 0, 0
        for field in NUMERIC_FIELDS:
            true_raw = row.get(field, '').strip()
            if true_raw == '':
                continue  # not applicable on this label, don't count it
            true_val = float(true_raw)
            field_stats[field]['expected'] += 1
            img_expected += 1

            if field not in predicted:
                field_stats[field]['missing'] += 1
                failure_cases.append({
                    'filename': fname, 'field': field, 'type': 'MISSING',
                    'true_value': true_val, 'predicted_value': None,
                    'ocr_confidence': ocr['avg_confidence'],
                })
                continue

            pred_val = predicted[field]
            if is_close(pred_val, true_val):
                field_stats[field]['correct'] += 1
                img_correct += 1
                field_stats[field]['abs_errors'].append(abs(pred_val - true_val))
            else:
                field_stats[field]['wrong'] += 1
                failure_cases.append({
                    'filename': fname, 'field': field, 'type': 'WRONG',
                    'true_value': true_val, 'predicted_value': pred_val,
                    'ocr_confidence': ocr['avg_confidence'],
                })

        per_image_counts.append((img_expected, img_correct))

        # --- allergens (per-row set comparison) ---
        tp = len(predicted_allergens & true_allergens)
        fp = len(predicted_allergens - true_allergens)
        fn = len(true_allergens - predicted_allergens)
        allergen_tp += tp
        allergen_fp += fp
        allergen_fn += fn
        if fp or fn:
            failure_cases.append({
                'filename': fname, 'field': 'ALLERGENS', 'type': 'MISMATCH',
                'true_value': ';'.join(sorted(true_allergens)) or '(none)',
                'predicted_value': ';'.join(sorted(predicted_allergens)) or '(none)',
                'ocr_confidence': ocr['avg_confidence'],
            })

    # ---------------- report ----------------
    report_lines = []
    report_lines.append("# OCR + Nutrition Parsing Accuracy Report\n")
    report_lines.append(f"Images evaluated: {len(gt_rows)}")
    report_lines.append(f"Flagged as low quality (blur/dark/overexposed) by check_image_quality: {quality_flagged}")
    report_lines.append(f"Flagged as low OCR confidence (<60 avg): {ocr_low_confidence}\n")

    report_lines.append("## Field-level accuracy (numeric fields)\n")
    report_lines.append("| Field | Expected | Correct | Wrong | Missing | Accuracy | Mean Abs Error |")
    report_lines.append("|---|---|---|---|---|---|---|")
    overall_expected, overall_correct = 0, 0
    for field, s in field_stats.items():
        if s['expected'] == 0:
            continue
        acc = s['correct'] / s['expected']
        mae = sum(s['abs_errors']) / len(s['abs_errors']) if s['abs_errors'] else float('nan')
        overall_expected += s['expected']
        overall_correct += s['correct']
        report_lines.append(f"| {field} | {s['expected']} | {s['correct']} | {s['wrong']} | {s['missing']} | {acc:.1%} | {mae:.2f} |")
    if overall_expected:
        report_lines.append(f"\n**Overall field accuracy: {overall_correct}/{overall_expected} = {overall_correct/overall_expected:.1%}**\n")

    ci = bootstrap_ci_over_images(per_image_counts)
    n_evaluated = len(per_image_counts)
    report_lines.append("## Sample-size caveat\n")
    report_lines.append(f"This is a **{n_evaluated}-photo** evaluation. Treat it as a directional smoke test, not a benchmark:")
    if ci and overall_expected:
        report_lines.append(f"- Overall field accuracy is {overall_correct/overall_expected:.1%}, but resampling the photos gives a 95% bootstrap interval of "
                            f"**{ci[0]:.1%} - {ci[1]:.1%}**. Fields within one photo are correlated (a blurry photo fails on almost every field at once), "
                            "so the effective sample is closer to the number of photos than to the number of fields.")
    report_lines.append("- Per-field rows above rest on even fewer photos (see the Expected column); a single photo moves a row by several points.")
    report_lines.append("- The photos are a hand-picked mix of clean shots, angled shots and two-column labels, not a random sample of real-world labels.")
    report_lines.append("- Before/after comparisons use the same photos the fixes were developed against, so improvements are likely overstated for unseen photos. "
                        "A held-out set of photos not used during development is the next step.\n")

    precision = allergen_tp / (allergen_tp + allergen_fp) if (allergen_tp + allergen_fp) else float('nan')
    recall = allergen_tp / (allergen_tp + allergen_fn) if (allergen_tp + allergen_fn) else float('nan')
    f1 = 2 * precision * recall / (precision + recall) if precision and recall and (precision + recall) else float('nan')
    report_lines.append("## Allergen detection\n")
    report_lines.append(f"True positives: {allergen_tp}, False positives: {allergen_fp}, False negatives: {allergen_fn}")
    report_lines.append(f"Precision: {precision:.1%} | Recall: {recall:.1%} | F1: {f1:.1%}\n")

    report_lines.append(f"## Failure cases: {len(failure_cases)} logged -> see failure_cases.csv\n")

    report_text = '\n'.join(report_lines)
    print(report_text)

    with open(os.path.join(out_dir, 'accuracy_report.md'), 'w') as f:
        f.write(report_text)

    with open(os.path.join(out_dir, 'failure_cases.csv'), 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['filename', 'field', 'type', 'true_value', 'predicted_value', 'ocr_confidence'])
        writer.writeheader()
        writer.writerows(failure_cases)

    with open(os.path.join(out_dir, 'summary.json'), 'w') as f:
        json.dump({
            'images_evaluated': len(gt_rows),
            'quality_flagged': quality_flagged,
            'ocr_low_confidence': ocr_low_confidence,
            'overall_field_accuracy': overall_correct / overall_expected if overall_expected else None,
            'overall_field_accuracy_ci95_bootstrap_over_images': list(ci) if ci else None,
            'allergen_precision': precision,
            'allergen_recall': recall,
            'allergen_f1': f1,
            'failure_case_count': len(failure_cases),
        }, f, indent=2)

    print(f"\nWrote accuracy_report.md, failure_cases.csv, summary.json to {out_dir}/")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--images_dir', required=True)
    parser.add_argument('--ground_truth', required=True)
    parser.add_argument('--out_dir', default='./report')
    args = parser.parse_args()
    evaluate(args.images_dir, args.ground_truth, args.out_dir)
