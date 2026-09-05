import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getHistory } from '../services/api';

function scoreColor(score) {
  if (score >= 70) return '#2e7d32';
  if (score >= 40) return '#f9a825';
  return '#c62828';
}

export default function HistoryScreen({ navigation }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const data = await getHistory();
      setScans(data.scans || []);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2e7d32" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>{error}</Text>
      </View>
    );
  }

  if (scans.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.mutedText}>No scans yet — analyze a label to see it here.</Text>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={scans}
      keyExtractor={(item) => item._id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('Results', { result: item })}
        >
          <View>
            <Text style={styles.cardTitle}>
              {item.openFoodFacts?.productName || 'Scanned label'}
            </Text>
            <Text style={styles.cardDate}>
              {new Date(item.createdAt).toLocaleString()}
            </Text>
          </View>
          {typeof item.healthScore === 'number' && (
            <View style={[styles.scoreBadge, { backgroundColor: scoreColor(item.healthScore) }]}>
              <Text style={styles.scoreBadgeText}>{item.healthScore}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  mutedText: { color: '#999', textAlign: 'center' },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#eee', marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardDate: { fontSize: 12, color: '#888', marginTop: 4 },
  scoreBadge: {
    width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center',
  },
  scoreBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
