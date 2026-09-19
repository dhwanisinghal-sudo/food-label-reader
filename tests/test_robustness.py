"""
test_robustness.py

Answers: "What happens when the image is blurred, rotated, or partially
cropped?" — with a controlled experiment instead of an anecdote.

Takes one or more CLEAN, already-correctly-extracted photos (ones that
scored well in accuracy_report.md) and generates degraded copies at known
severity levels, then runs the real pipeline (check_image_quality ->
deskew_image -> extract_text_best_effort -> parse_nutrition) against each
copy and reports which fields survive.

Usage:
    python test_robustness.py --image label_photos/dr_praegers_california_veggie_burger.jpg --out_dir robustness_report

Requires opencv-python, numpy (already in requirements.txt).
"""

import argparse
import copy
import csv
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src'))
from nutrition_parser import check_image_quality, deskew_image, extract_text_best_effort, parse_nutrition  # noqa: E402


def make_blurred(img, ksize):
    return cv2.GaussianBlur(img, (ksize, ksize), 0)


def make_rotated(img, angle_deg):
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    # White background fill so it looks like a photo taken at an angle,
    # not a black-cornered rotation artifact that would never occur in
    # a real photo and could bias the result.
    return cv2.warpAffine(img, matrix, (w, h), borderValue=(255, 255, 255))


def make_cropped(img, fraction_removed):
    h, w = img.shape[:2]
    # Crop from the bottom - where a nutrition panel's later rows
    # (fiber, sugars, protein) typically sit, so this simulates the
    # realistic failure of "the bottom of the label didn't fit in frame".
    new_h = int(h * (1 - fraction_removed))
    return img[:new_h, :]


DEGRADATIONS = {
    'clean_baseline': lambda img: img,
    'blur_mild': lambda img: make_blurred(img, 5),
    'blur_heavy': lambda img: make_blurred(img, 15),
    'rotate_5deg': lambda img: make_rotated(img, 5),
    'rotate_15deg': lambda img: make_rotated(img, 15),
    'rotate_30deg': lambda img: make_rotated(img, 30),
    'crop_10pct': lambda img: make_cropped(img, 0.10),
    'crop_25pct': lambda img: make_cropped(img, 0.25),
}


def run_one(image_path, out_dir):
    img = cv2.imread(image_path)
    if img is None:
        print(f"Could not read {image_path}")
        return []

    base = os.path.splitext(os.path.basename(image_path))[0]
    rows = []
    for label, transform in DEGRADATIONS.items():
        degraded = transform(img.copy())
        degraded_path = os.path.join(out_dir, f"{base}__{label}.jpg")
        cv2.imwrite(degraded_path, degraded)

        quality = check_image_quality(degraded_path)
        try:
            working_path = deskew_image(degraded_path, output_path=os.path.join(out_dir, f"_deskew__{base}__{label}.jpg"))
            ocr_result = extract_text_best_effort(working_path)
            # BUG FIX: extract_text_best_effort() already returns parsed
            # nutrition fields under ocr_result['nutrition'] -- this used to
            # pass the whole result dict into parse_nutrition() again (which
            # expects a raw string), silently throwing on every single row
            # ("expected string or bytes-like object, got 'dict'") and
            # getting swallowed by the except below, which made EVERY row
            # -- including clean_baseline -- report 0 fields extracted, even
            # though the same images score ~60% in accuracy_report.md.
            nutrition = ocr_result['nutrition']
        except Exception as e:  # noqa: BLE001 - we want to record a crash as a result, not stop the run
            nutrition = {}

        quality_ok = quality.get('ok', True) if isinstance(quality, dict) else True
        quality_issues = '; '.join(quality.get('issues', [])) if isinstance(quality, dict) else ''
        rows.append({
            'source_image': base,
            'degradation': label,
            'quality_ok': quality_ok,
            'quality_issues': quality_issues,
            'fields_extracted': len(nutrition),
            'extracted_keys': ','.join(sorted(nutrition.keys())),
        })
        print(f"  {label:16s} -> {len(nutrition)} fields extracted"
              f"{' (quality issue: ' + quality_issues + ')' if not quality_ok else ''}")
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', action='append', required=True,
                         help='Path to a clean source photo. Repeat --image to test more than one.')
    parser.add_argument('--out_dir', default='robustness_report')
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    all_rows = []
    for image_path in args.image:
        print(f"\n{os.path.basename(image_path)}:")
        all_rows.extend(run_one(image_path, args.out_dir))

    csv_path = os.path.join(args.out_dir, 'robustness_results.csv')
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['source_image', 'degradation', 'quality_ok', 'quality_issues', 'fields_extracted', 'extracted_keys'])
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nFull results written to {csv_path}")
    print("Compare 'fields_extracted' at each degradation level against 'clean_baseline' to see exactly")
    print("how many fields are lost at each severity of blur/rotation/crop -- paste this table into the report.")


if __name__ == '__main__':
    main()
