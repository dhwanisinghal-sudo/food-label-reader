# Why Tesseract OCR (not EasyOCR or PaddleOCR)

This wasn't documented anywhere in the repo before — here's the honest comparison and
the actual reasoning, for the record.

## The three options

| | Tesseract | EasyOCR | PaddleOCR |
|---|---|---|---|
| Type | Traditional OCR engine (LSTM-based since v4) | Deep-learning OCR (PyTorch) | Deep-learning OCR (PaddlePaddle) |
| Install size | ~15-20MB system binary | ~500MB+ (PyTorch + model weights) | ~300MB+ (PaddlePaddle + model weights) |
| Runtime dependency | A single native binary (`tesseract-ocr`) | Full Python ML stack (torch, torchvision) | Full Python ML stack (paddlepaddle) |
| Works from Node.js | Yes — shell out to the binary (`node-tesseract-ocr`) | No native/mature Node binding; would need a Python microservice | No native/mature Node binding; same problem |
| Typical accuracy on clean, printed text | Good | Generally better, especially on natural/curved scenes | Generally better, especially on natural/curved scenes |
| Cold-start / inference speed on a small server | Fast (CPU, no model load) | Slower — loads a neural net into memory per request unless kept warm | Slower — same issue |

## Why Tesseract, given this project's actual constraints

1. **The web app backend is Node.js/Express**, not Python. Tesseract is the only one of
   the three with a working, simple Node integration (`node-tesseract-ocr`, which just
   shells out to the `tesseract` binary). EasyOCR and PaddleOCR are Python-only libraries
   with no mature Node binding — using either would mean running a separate Python
   microservice alongside the Node backend, which is a real architecture change, not a
   drop-in swap.
2. **Deployment footprint.** The web app is deployed on Render's free tier (small
   memory/CPU). Tesseract's binary + language data is tens of megabytes and has no model
   to load into memory. EasyOCR/PaddleOCR pull in a full deep-learning framework
   (hundreds of MB) and load neural network weights on every cold start — a meaningfully
   heavier deployment for a project already sized to fit a small free-tier instance
   (see the memory-pressure comment in `preprocessForOcr()` in `src/server.js`, which
   downsizes images specifically to avoid OOM kills on that tier).
3. **The notebook is Python**, so Tesseract via `pytesseract` was a natural default there
   too, and keeping the same OCR engine across the notebook and the web app avoids two
   completely different OCR behaviors to reason about.

## What this trade-off actually costs

This is a real trade-off, not a free win — it's being written down honestly rather than
glossed over:

- EasyOCR and PaddleOCR are generally **more accurate on harder photos** (curved
  packaging, low light, complex backgrounds) precisely because they're deep-learning
  models trained on more varied real-world text, versus Tesseract's more traditional
  approach. Several of the accuracy failures logged in `tests/failure_cases.csv`
  (angled containers, low-confidence/blurry shots) are exactly the kind of case where a
  deep-learning OCR engine would likely do better.
- This project did not run a side-by-side accuracy comparison of the three engines on
  the same 15-photo test set — that would be the honest next step to quantify this
  trade-off rather than reason about it qualitatively. It hasn't been done due to the
  Node-integration cost described above, not because the comparison wouldn't be useful.

## Bottom line

Tesseract was chosen for **deployment simplicity and integration fit with a Node.js
backend**, not because it was benchmarked as the most accurate option. If OCR accuracy
on difficult photos becomes the priority over deployment simplicity, EasyOCR/PaddleOCR
via a Python microservice is the documented alternative worth testing next.
