import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

// Matches the backend's actual thresholds exactly (calculateHealthScore in
// nutritionParser.js): >=80 Excellent, >=60 Good, >=40 Moderate, else Poor.
function scoreColor(score) {
  if (score >= 80) return '#2e7d32'; // Excellent
  if (score >= 60) return '#66bb6a'; // Good
  if (score >= 40) return '#f9a825'; // Moderate
  return '#c62828'; // Poor
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// Human-readable labels for additive category keys — mirrors
// ADDITIVE_CATEGORY_LABELS in the backend's nutritionParser.js.
const ADDITIVE_CATEGORY_LABELS = {
  artificialColors: 'Artificial Colors',
  artificialSweeteners: 'Artificial Sweeteners',
  nitritesNitrates: 'Nitrite/Nitrate Preservatives',
  otherPreservatives: 'Preservatives',
  hydrogenatedOils: 'Partially Hydrogenated Oil',
  flavorEnhancers: 'Flavor Enhancers',
};

// Human-readable label for the ageGroup code the backend echoes back.
const AGE_GROUP_LABELS = {
  adults_children_4plus: 'Adult / Child 4+',
  children_1_3: 'Toddler (1–3 yrs)',
  pregnant_lactating: 'Pregnant / Lactating',
};

// A small horizontal bar showing %DV at a glance, capped visually at 100%
// so a >100% nutrient doesn't overflow the row — the number label still
// shows the true value.
function DVBar({ pct }) {
  if (typeof pct !== 'number') return null;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pct >= 20 ? '#c62828' : pct >= 5 ? '#f9a825' : '#2e7d32';
  return (
    <View style={styles.dvBarTrack}>
      <View style={[styles.dvBarFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

export default function ResultsScreen({ route }) {
  const { result } = route.params;
  const {
    nutrition = {}, dailyValuePercent = {}, ingredients = [], allergens = [],
    additives = {}, additiveInfo = {}, dietCompatibility, healthScore, healthAnalysis,
    barcode, barcodeType, openFoodFacts, ageGroup,
  } = result || {};

  // additives is an OBJECT keyed by category — {artificialColors: ['Red 40'], ...}
  // — not an array, so it can't use .length directly.
  const additiveCategories = Object.keys(additives).filter(
    (cat) => additives[cat] && additives[cat].length > 0,
  );

  // The backend returns healthScore as an OBJECT — { score, label, breakdown }
  // — not a plain number. score/label can be null when no nutrition data was
  // extracted at all (see calculateHealthScore in nutritionParser.js).
  const scoreValue = healthScore && typeof healthScore === 'object' ? healthScore.score : null;
  const scoreLabel = healthScore && typeof healthScore === 'object' ? healthScore.label : null;
  const scoreBreakdown = (healthScore && typeof healthScore === 'object' && healthScore.breakdown) || [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {ageGroup && (
        <Text style={styles.ageGroupTag}>
          %DV reference: {AGE_GROUP_LABELS[ageGroup] || ageGroup}
        </Text>
      )}
      {typeof scoreValue === 'number' && (
        <>
          <View style={[styles.scoreCard, { borderColor: scoreColor(scoreValue) }]}>
            <Text style={[styles.scoreValue, { color: scoreColor(scoreValue) }]}>{scoreValue}</Text>
            <Text style={styles.scoreLabel}>/ 100</Text>
          </View>
          {scoreLabel && (
            <View style={[styles.ratingBadge, { backgroundColor: scoreColor(scoreValue) }]}>
              <Text style={styles.ratingBadgeText}>{scoreLabel}</Text>
            </View>
          )}
          {scoreBreakdown.length > 0 && (
            <View style={styles.breakdownBox}>
              {scoreBreakdown.map((item, idx) => (
                <Text key={idx} style={styles.breakdownText}>
                  {item.delta > 0 ? '➕' : '➖'} {item.reason} ({item.delta > 0 ? '+' : ''}{item.delta})
                </Text>
              ))}
            </View>
          )}
        </>
      )}
      {scoreLabel && scoreValue === null && (
        <Text style={[styles.mutedText, { textAlign: 'center', marginBottom: 20 }]}>{scoreLabel}</Text>
      )}

      {healthAnalysis && (
        <Section title="🧠 Health Analysis">
          <Text style={styles.bodyText}>
            {typeof healthAnalysis === 'string' ? healthAnalysis : JSON.stringify(healthAnalysis)}
          </Text>
        </Section>
      )}

      <Section title="🍽 Nutrition Facts">
        {Object.keys(nutrition).length === 0 ? (
          <Text style={styles.mutedText}>No nutrition data extracted from this photo.</Text>
        ) : (
          Object.entries(nutrition).map(([key, value]) => (
            <View key={key} style={styles.nutrientBlock}>
              <View style={styles.factRow}>
                <Text style={styles.factLabel}>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
                <Text style={styles.factValue}>
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  {dailyValuePercent[key] != null ? `  (${dailyValuePercent[key]}% DV)` : ''}
                </Text>
              </View>
              <DVBar pct={dailyValuePercent[key]} />
            </View>
          ))
        )}
      </Section>

      {allergens.length > 0 && (
        <Section title="⚠️ Allergens Detected">
          <Text style={styles.bodyText}>{allergens.join(', ')}</Text>
        </Section>
      )}

      {additiveCategories.length > 0 && (
        <Section title="🧪 Additives">
          {additiveCategories.map((cat) => (
            <View key={cat} style={styles.additiveBlock}>
              <Text style={styles.additiveTitle}>
                {ADDITIVE_CATEGORY_LABELS[cat] || cat}
              </Text>
              <Text style={styles.bodyText}>{additives[cat].join(', ')}</Text>
              {additiveInfo[cat] && (
                <Text style={styles.additiveNote}>ℹ️ {additiveInfo[cat]}</Text>
              )}
            </View>
          ))}
        </Section>
      )}

      {dietCompatibility && (
        <Section title="🥦 Diet Compatibility">
          {Object.entries(dietCompatibility).map(([diet, compatible]) => (
            <Text key={diet} style={styles.bodyText}>
              {compatible ? '✅' : '❌'} {diet}
            </Text>
          ))}
        </Section>
      )}

      {ingredients.length > 0 && (
        <Section title="📋 Ingredients">
          <Text style={styles.bodyText}>{ingredients.join(', ')}</Text>
        </Section>
      )}

      <Section title="📦 Product Lookup">
        {barcode ? (
          <>
            <Text style={styles.bodyText}>Barcode: {barcode} ({barcodeType})</Text>
            {openFoodFacts?.found ? (
              <>
                {openFoodFacts.productName && (
                  <Text style={styles.bodyText}>Product: {openFoodFacts.productName}</Text>
                )}
                {openFoodFacts.nutriScore && (
                  <Text style={styles.bodyText}>Nutri-Score: {openFoodFacts.nutriScore}</Text>
                )}
                {openFoodFacts.novaGroup && (
                  <Text style={styles.bodyText}>NOVA Group: {openFoodFacts.novaGroup}</Text>
                )}
                {openFoodFacts.ecoScore && (
                  <Text style={styles.bodyText}>Eco-Score: {openFoodFacts.ecoScore}</Text>
                )}
              </>
            ) : (
              <Text style={styles.mutedText}>
                {openFoodFacts?.reason || 'Product not found on OpenFoodFacts.'}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.mutedText}>No barcode or QR code detected in the photo.</Text>
        )}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60, backgroundColor: '#fff' },
  ageGroupTag: {
    fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 10,
    backgroundColor: '#f2f2f2', alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12,
  },
  scoreCard: {
    alignSelf: 'center', width: 140, height: 140, borderRadius: 70, borderWidth: 6,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  scoreValue: { fontSize: 40, fontWeight: '800' },
  scoreLabel: { fontSize: 12, color: '#666', marginTop: 4 },
  ratingBadge: {
    alignSelf: 'center', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 18, marginBottom: 14,
  },
  ratingBadgeText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  breakdownBox: { marginBottom: 22, paddingHorizontal: 8 },
  breakdownText: { fontSize: 13, color: '#555', marginBottom: 4 },
  section: {
    marginBottom: 18, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 14,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  bodyText: { fontSize: 14, color: '#333', lineHeight: 20, marginBottom: 4 },
  mutedText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  factLabel: { fontSize: 14, color: '#555', textTransform: 'capitalize' },
  factValue: { fontSize: 14, color: '#111', fontWeight: '600' },
  nutrientBlock: { marginBottom: 8 },
  dvBarTrack: {
    height: 5, borderRadius: 3, backgroundColor: '#eee', overflow: 'hidden', marginTop: 2,
  },
  dvBarFill: { height: '100%', borderRadius: 3 },
  additiveBlock: { marginBottom: 12 },
  additiveTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 2 },
  additiveNote: { fontSize: 12, color: '#777', lineHeight: 17, marginTop: 3 },
});
