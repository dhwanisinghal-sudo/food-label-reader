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
    # One photo:
    python test_robustness.py --image label_photos/dr_praegers_california_veggie_burger.jpg --out_dir robustness_report

    # Several named photos:
    python test_robustness.py --image photo1.jpg --image photo2.jpg --out_dir robustness_report

    # Every photo in a folder (e.g. the same 15 used in accuracy_report.md,
    # so robustness is actually measured across the test set, not one photo):
    python test_robustness.py --images_dir tests/label_photos --out_dir robustness_report

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
        ocr_result = {}
        error = ''
        try:
            working_path = deskew_image(degraded_path, output_path=os.path.join(out_dir, f"_deskew__{base}__{label}.jpg"))
            ocr_result = extract_text_best_effort(working_path)
            # BUG FIX: extract_text_best_effort() already returns parsed
            # nutrition fields under ocr_result['nutrition'] -- this used to
            # pass the whole result dict into parse_nutrition() again (which
            # expects a raw string), silently throwing on every single row
            # and making EVERY row -- including clean_baseline -- report 0
            # fields extracted.
            nutrition = ocr_result['nutrition']
        except Exception as e:  # noqa: BLE001 - we want to record a crash as a result, not stop the run
            nutrition = {}
            error = f"{type(e).__name__}: {e}"

        # Save the raw OCR text for every variant. When a field goes missing
        # (e.g. calories on a cropped image) this is the file to open: if the
        # word "Calories" is absent, OCR/layout is the cause; if it is present
        # but the value wasn't parsed, the regex is the cause.
        raw_text = ocr_result.get('text', '')
        with open(os.path.join(out_dir, f"{base}__{label}__ocr.txt"), 'w', encoding='utf-8') as tf:
            tf.write(raw_text)

        quality_ok = quality.get('ok', True) if isinstance(quality, dict) else True
        quality_issues = '; '.join(quality.get('issues', [])) if isinstance(quality, dict) else ''
        fields_found = ocr_result.get('fields_found', sum(1 for k in nutrition if k.endswith(('_g', '_mg')) or k == 'calories'))
        rows.append({
            'source_image': base,
            'degradation': label,
            'quality_ok': quality_ok,
            'quality_issues': quality_issues,
            'ocr_confidence': ocr_result.get('avg_confidence', ''),
            'reliable': ocr_result.get('reliable', ''),
            'fields_extracted': fields_found,
            'calories_found': 'calories' in nutrition,
            'calories_word_in_ocr_text': 'calories' in raw_text.lower(),
            'extracted_keys': ','.join(sorted(nutrition.keys())),
            'error': error,
        })
        print(f"  {label:16s} -> conf {ocr_result.get('avg_confidence', '-')!s:>5} | reliable={ocr_result.get('reliable', '-')!s:5} | "
              f"{fields_found} fields | calories={'yes' if 'calories' in nutrition else 'NO'}"
              f"{' (quality issue: ' + quality_issues + ')' if not quality_ok else ''}"
              f"{' ERROR ' + error if error else ''}")
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', action='append', default=[],
                         help='Path to a clean source photo. Repeat --image to test more than one.')
    parser.add_argument('--images_dir', default=None,
                         help='Convenience alternative to repeating --image: run every .jpg/.jpeg/.png '
                              'in this directory. Can be combined with --image; duplicates are de-duped. '
                              'This is what actually gets you a robustness result ACROSS the accuracy '
                              'test set instead of just one photo — e.g. --images_dir tests/label_photos '
                              'to run every one of the 15 accuracy-report photos through every degradation.')
    parser.add_argument('--out_dir', default='robustness_report')
    args = parser.parse_args()

    image_paths = list(args.image)
    if args.images_dir:
        if not os.path.isdir(args.images_dir):
            parser.error(f'--images_dir {args.images_dir!r} is not a directory')
        exts = ('.jpg', '.jpeg', '.png')
        found = sorted(
            os.path.join(args.images_dir, fn)
            for fn in os.listdir(args.images_dir)
            if fn.lower().endswith(exts)
        )
        if not found:
            parser.error(f'No .jpg/.jpeg/.png files found in {args.images_dir!r}')
        image_paths.extend(found)

    # De-dupe while preserving order, in case the same photo was named via
    # both --image and picked up by --images_dir.
    seen = set()
    deduped = []
    for p in image_paths:
        norm = os.path.abspath(p)
        if norm not in seen:
            seen.add(norm)
            deduped.append(p)
    image_paths = deduped

    if not image_paths:
        parser.error('No images to test -- pass at least one --image or a non-empty --images_dir')

    os.makedirs(args.out_dir, exist_ok=True)
    all_rows = []
    for image_path in image_paths:
        print(f"\n{os.path.basename(image_path)}:")
        all_rows.extend(run_one(image_path, args.out_dir))

    csv_path = os.path.join(args.out_dir, 'robustness_results.csv')
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['source_image', 'degradation', 'quality_ok', 'quality_issues', 'ocr_confidence', 'reliable', 'fields_extracted', 'calories_found', 'calories_word_in_ocr_text', 'extracted_keys', 'error'])
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nFull results written to {csv_path}")
    print("Compare 'fields_extracted' at each degradation level against 'clean_baseline' to see exactly")
    print("how many fields are lost at each severity of blur/rotation/crop -- paste this table into the report.")
    print("A row with high ocr_confidence but reliable=False and few fields is the intended behavior: the")
    print("pipeline is now refusing to call an empty extraction 'reliable'. calories_found=False with")
    print("calories_word_in_ocr_text=True means the regex missed it; both False means OCR/layout missed it.")


if __name__ == '__main__':
    main()
