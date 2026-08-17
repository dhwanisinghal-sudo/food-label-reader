/**
 * barcodeReader.js
 * Decodes barcodes and QR codes from an uploaded label photo using zedbar
 * (a Rust->WASM port of ZBar). No native/system dependencies required —
 * unlike pyzbar (Python side), which needs libzbar0 installed separately.
 */

const fs = require('fs');
const { scanImageBytes } = require('zedbar');

// Standard 1D product barcodes — the scanned text IS the GTIN.
const LINEAR_BARCODE_TYPES = new Set([
  'EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'ISBN-10', 'ISBN-13',
]);

// GS1 Digital Link QR codes encode the GTIN inside a URL path segment,
// e.g. https://id.gs1.org/01/03017620425035 -> GTIN is 03017620425035.
const GS1_DIGITAL_LINK_RE = /\/01\/(\d{8,14})(?:[/?]|$)/;

/**
 * Given raw decoded text from any barcode/QR symbol, tries to extract a
 * usable GTIN/EAN/UPC product code. Returns the digit string, or null if
 * the text isn't a recognizable product code (e.g. a random promo URL).
 */
function extractProductCode(text) {
  const trimmed = text.trim();

  // Case 1: the QR just encodes the number directly (8-14 digits).
  if (/^\d{8,14}$/.test(trimmed)) return trimmed;

  // Case 2: GS1 Digital Link URL — GTIN is embedded in the path.
  const gs1Match = trimmed.match(GS1_DIGITAL_LINK_RE);
  if (gs1Match) return gs1Match[1];

  return null;
}

/**
 * Scans an image file for a barcode or QR code.
 * Returns { code, symbolType, isProductCode } for the first symbol found,
 * or null if nothing was detected.
 *
 * - Linear barcodes (EAN/UPC/ISBN): code is used as-is.
 * - QR codes: code is extracted if it's a plain GTIN or a GS1 Digital Link;
 *   otherwise isProductCode is false and `code` holds the raw scanned text
 *   (e.g. a URL) so the caller can still show what was scanned.
 */
function readBarcode(filePath) {
  try {
    const bytes = fs.readFileSync(filePath);
    const results = scanImageBytes(bytes);

    for (const r of results) {
      if (LINEAR_BARCODE_TYPES.has(r.symbolType)) {
        return { code: r.text, symbolType: r.symbolType, isProductCode: true };
      }
      if (r.symbolType === 'QR-Code') {
        const productCode = extractProductCode(r.text);
        return productCode
          ? { code: productCode, symbolType: 'QR-Code', isProductCode: true }
          : { code: r.text, symbolType: 'QR-Code', isProductCode: false };
      }
    }
    return null;
  } catch (err) {
    // A failed decode (e.g. unsupported image format, no code present)
    // shouldn't break the rest of the analysis — just report nothing found.
    console.error('Barcode scan failed:', err.message);
    return null;
  }
}

module.exports = { readBarcode };
