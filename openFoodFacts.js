/**
 * openFoodFacts.js
 * Looks up a scanned barcode against the OpenFoodFacts database to get
 * Nutri-Score, NOVA processing group, and Eco-Score. Free, no API key.
 */

const fetch = require('node-fetch');

const OFF_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = [
  'product_name', 'brands', 'quantity', 'image_url',
  'nutriscore_grade', 'nova_group', 'ecoscore_grade',
].join(',');

// OpenFoodFacts asks API consumers to identify their app with a
// descriptive User-Agent (not an API key — the API itself is open).
const USER_AGENT = 'FoodLabelReader/1.0 (student project; https://github.com/dhwanisinghal-sudo/food-label-reader)';

/**
 * Looks up a barcode on OpenFoodFacts.
 * Returns { found: true, ...product } or { found: false, reason } —
 * never throws, so a lookup failure never breaks the rest of /api/analyze.
 */
async function lookupProduct(barcode) {
  if (!barcode) return { found: false, reason: 'No barcode provided' };

  const url = `${OFF_BASE_URL}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 8000,
    });

    if (!response.ok) {
      return { found: false, reason: `OpenFoodFacts API error (${response.status})` };
    }

    const data = await response.json();

    // API v2 returns status: 1 (found) or 0 (not found); some deployments
    // use "success"/"failure" strings, so check loosely.
    const isFound = data.status === 1 || data.status === 'success' || !!data.product;
    if (!isFound || !data.product) {
      return { found: false, reason: 'Product not registered on OpenFoodFacts' };
    }

    const p = data.product;
    return {
      found: true,
      barcode,
      productName: p.product_name || null,
      brands: p.brands || null,
      quantity: p.quantity || null,
      imageUrl: p.image_url || null,
      nutriScore: (p.nutriscore_grade || null)?.toUpperCase() || null,
      novaGroup: p.nova_group || null,
      ecoScore: (p.ecoscore_grade || null)?.toUpperCase() || null,
    };
  } catch (err) {
    return { found: false, reason: `Lookup failed: ${err.message}` };
  }
}

module.exports = { lookupProduct };
