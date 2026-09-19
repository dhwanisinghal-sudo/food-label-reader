"""
manual_review.py

Answers a question accuracy_report.md currently CANNOT answer: "how many
OCR values were manually corrected?" Everything evaluate_accuracy.py logs
(char-substitution fixes, %DV cross-check overrides) is a MECHANICAL
correction the parser made to itself -- nobody has looked at a photo and
confirmed what the parser got wrong or fixed it by hand. This script is
the missing human-in-the-loop step, built as two small commands around
the failure_cases.csv that evaluate_accuracy.py already produces.

Workflow:
    1. Run evaluate_accuracy.py as usual -> produces failure_cases.csv.
    2. python manual_review.py template --failure_cases report/failure_cases.csv \
           --out manual_review.csv
       -> writes manual_review.csv: every logged mismatch, plus empty
          columns for a human to fill in by actually looking at the photo.
    3. Open manual_review.csv, open each named photo, and for every row
       fill in:
         - manually_corrected_value: what the label ACTUALLY says (by eye).
           Leave blank only if you can't tell from the photo either.
         - reviewer: your name/initials.
         - review_date: YYYY-MM-DD.
       (true_value is already filled in from ground_truth.csv -- you're
       confirming/correcting THAT, not re-deriving it. If true_value was
       already right, just copy it into manually_corrected_value so the
       row is marked reviewed.)
    4. python manual_review.py tally --reviewed manual_review.csv
       -> prints/writes the actual "how many values were manually
          corrected" numbers evaluate_accuracy.py can't produce on its own:
          how many rows were reviewed at all, how many of those needed a
          real correction vs. confirmed the ground truth was already
          right, and a breakdown by field.

This deliberately does NOT try to auto-guess corrections -- that would
just be another mechanical heuristic wearing a "manual" label. A row only
counts as manually corrected once a person has actually written something
into manually_corrected_value.
"""

import argparse
import csv
import os


FAILURE_FIELDS = ['filename', 'field', 'type', 'true_value', 'predicted_value', 'ocr_confidence']
REVIEW_EXTRA_FIELDS = ['manually_corrected_value', 'reviewer', 'review_date', 'notes']
REVIEW_FIELDS = FAILURE_FIELDS + REVIEW_EXTRA_FIELDS


def cmd_template(args):
    if not os.path.exists(args.failure_cases):
        raise SystemExit(f"Can't find {args.failure_cases} -- run evaluate_accuracy.py first.")

    with open(args.failure_cases, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print(f"{args.failure_cases} has no rows -- nothing to review (every field matched ground truth).")
        return

    with open(args.out, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        for row in rows:
            out_row = {k: row.get(k, '') for k in FAILURE_FIELDS}
            for k in REVIEW_EXTRA_FIELDS:
                out_row[k] = ''
            writer.writerow(out_row)

    print(f"Wrote {len(rows)} rows to {args.out}")
    print("Open the photos and fill in manually_corrected_value, reviewer, review_date for each row.")
    print("Then run: python manual_review.py tally --reviewed " + args.out)


def cmd_tally(args):
    if not os.path.exists(args.reviewed):
        raise SystemExit(f"Can't find {args.reviewed} -- run the 'template' command first, then fill it in.")

    with open(args.reviewed, newline='', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    total = len(rows)
    reviewed = [r for r in rows if (r.get('manually_corrected_value') or '').strip() != '']
    unreviewed = total - len(reviewed)

    # A row is a "real manual correction" if the human's value differs from
    # what the automatic pipeline predicted (predicted_value) -- i.e. the
    # human actually changed something, as opposed to just confirming the
    # existing ground_truth/prediction was fine and marking it reviewed.
    corrected = []
    confirmed_no_change = []
    for r in reviewed:
        predicted = (r.get('predicted_value') or '').strip()
        manual = (r.get('manually_corrected_value') or '').strip()
        if manual != predicted:
            corrected.append(r)
        else:
            confirmed_no_change.append(r)

    by_field = {}
    for r in corrected:
        field = r.get('field', 'unknown')
        by_field[field] = by_field.get(field, 0) + 1

    lines = []
    lines.append("# Manual Review Tally\n")
    lines.append(f"Logged mismatches from evaluate_accuracy.py: **{total}**")
    lines.append(f"Rows actually reviewed by a person: **{len(reviewed)}** ({unreviewed} not yet reviewed)")
    lines.append(f"Rows where the manual review changed the value (real manual corrections): **{len(corrected)}**")
    lines.append(f"Rows where manual review confirmed no change was needed: **{len(confirmed_no_change)}**\n")
    if by_field:
        lines.append("## Manual corrections by field\n")
        lines.append("| Field | Manually corrected |")
        lines.append("|---|---|")
        for field, count in sorted(by_field.items(), key=lambda kv: -kv[1]):
            lines.append(f"| {field} | {count} |")
        lines.append("")
    if unreviewed:
        lines.append(f"**{unreviewed} row(s) in {args.reviewed} still have no manually_corrected_value "
                      "-- these are NOT counted above.** Fill them in and re-run this command for a "
                      "complete number.\n")

    report = '\n'.join(lines)
    print(report)

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"\nAlso wrote this to {args.out}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)

    p_template = sub.add_parser('template', help='Build a fill-in-the-blanks review sheet from failure_cases.csv')
    p_template.add_argument('--failure_cases', default='report/failure_cases.csv',
                             help='Path to failure_cases.csv produced by evaluate_accuracy.py')
    p_template.add_argument('--out', default='manual_review.csv',
                             help='Where to write the review template')
    p_template.set_defaults(func=cmd_template)

    p_tally = sub.add_parser('tally', help='Count manual corrections from a filled-in review sheet')
    p_tally.add_argument('--reviewed', default='manual_review.csv',
                          help='Path to your filled-in manual_review.csv')
    p_tally.add_argument('--out', default=None,
                          help='Optional path to also save the tally report as a .md file')
    p_tally.set_defaults(func=cmd_tally)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
