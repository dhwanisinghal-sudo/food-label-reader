/**
 * MultiResultsScreen.js
 *
 * Renders the outcome of a multi-image scan (see ScanScreen.js's
 * handleAnalyzeMulti) as a tappable list — one row per photo, showing its
 * thumbnail and health score badge (or an error message if that specific
 * photo's analysis failed). Tapping a row reuses the EXISTING single-photo
 * ResultsScreen for the detail view, passing just that photo's result —
 * this avoids duplicating any of ResultsScreen's rendering logic.
 */
import React from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
} from 'react-native';

function scoreColor(score) {
  if (score == null) return '#999';
  if (score >= 80) return '#2e7d32';
  if (score >= 60) return '#66bb6a';
  if (score >= 40) return '#f9a825';
  return '#c62828';
}

export default function MultiResultsScreen({ route, navigation }) {
  const { items } = route.params; // [{ uri, result, error }]
  const successCount = items.filter((i) => i.result).length;

  return (
    <View style={styles.container}>
      <Text style={styles.summary}>
        {successCount} of {items.length} photo{items.length === 1 ? '' : 's'} analyzed successfully
      </Text>
      <FlatList
        data={items}
        keyExtractor={(item, idx) => `${idx}-${item.uri}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const score = item.result?.healthScore?.score;
          const label = item.result?.healthScore?.label;
          return (
            <TouchableOpacity
              style={styles.row}
              disabled={!item.result}
              onPress={() => item.result && navigation.navigate('Results', { result: item.result })}
            >
              <Image source={{ uri: item.uri }} style={styles.thumb} />
              <View style={styles.rowText}>
                {item.result ? (
                  <>
                    <Text style={[styles.score, { color: scoreColor(score) }]}>
                      {score != null ? `${score}/100` : 'N/A'} {label ? `— ${label}` : ''}
                    </Text>
                    <Text style={styles.tapHint}>Tap for full details</Text>
                  </>
                ) : (
                  <Text style={styles.errorText}>{item.error || 'Analysis failed for this photo'}</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  summary: { padding: 16, fontSize: 14, color: '#555', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  thumb: {
    width: 64, height: 64, borderRadius: 8, marginRight: 14, backgroundColor: '#f0f0f0',
  },
  rowText: { flex: 1 },
  score: { fontSize: 16, fontWeight: '700' },
  tapHint: { fontSize: 12, color: '#999', marginTop: 2 },
  errorText: { fontSize: 13, color: '#c62828' },
});
