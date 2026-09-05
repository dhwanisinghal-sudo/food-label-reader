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

export default function ResultsScreen({ route }) {
  const { result } = route.params;
  const {
    nutrition = {}, dailyValuePercent = {}, ingredients = [], allergens = [],
    additives = [], dietCompatibility, healthScore, healthAnalysis,
    barcode, barcodeType, openFoodFacts,
  } = result || {};

  // The backend returns healthScore as an OBJECT — { score, label, breakdown }
  // — not a plain number. score/label can be null when no nutrition data was
  // extracted at all (see calculateHealthScore in nutritionParser.js).
  const scoreValue = healthScore && typeof healthScore === 'object' ? healthScore.score : null;
  const scoreLabel = healthScore && typeof healthScore === 'object' ? healthScore.label : null;
  const scoreBreakdown = (healthScore && typeof healthScore === 'object' && healthScore.breakdown) || [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
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
            <View key={key} style={styles.factRow}>
              <Text style={styles.factLabel}>{key}</Text>
              <Text style={styles.factValue}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                {dailyValuePercent[key] ? `  (${dailyValuePercent[key]}% DV)` : ''}
              </Text>
            </View>
          ))
        )}
      </Section>

      {allergens.length > 0 && (
        <Section title="⚠️ Allergens Detected">
          <Text style={styles.bodyText}>{allergens.join(', ')}</Text>
        </Section>
      )}

      {additives.length > 0 && (
        <Section title="🧪 Additives">
          <Text style={styles.bodyText}>{additives.join(', ')}</Text>
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
});
