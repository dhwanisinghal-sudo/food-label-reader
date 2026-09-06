import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { analyzeLabel } from '../services/api';

// These MUST match the condition codes the backend actually recognizes —
// see CONDITION_LABELS and the per-condition checks in llmNutritionist.js.
// Using any other string here means the chip shows in the UI but silently
// does nothing server-side.
const CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'high_bp', label: 'High Blood Pressure' },
  { id: 'high_cholesterol', label: 'High Cholesterol' },
  { id: 'heart_disease', label: 'Heart Disease' },
  { id: 'kidney_disease', label: 'Kidney Disease' },
  { id: 'weight_management', label: 'Weight Management' },
  { id: 'pregnancy', label: 'Pregnancy' },
  { id: 'nut_allergy', label: 'Nut Allergy' },
  { id: 'dairy_intolerance', label: 'Dairy / Lactose Intolerance' },
  { id: 'gluten_celiac', label: 'Gluten / Celiac' },
  { id: 'egg_allergy', label: 'Egg Allergy' },
];

// Matches the three age groups the backend recognizes (see server.js's
// ageGroup whitelist) — these are the FDA's own population groups from
// 21 CFR 101.9, each with different official Daily Values.
const AGE_GROUPS = [
  { id: 'adults_children_4plus', label: 'Adult / Child 4+' },
  { id: 'children_1_3', label: 'Toddler (1–3 yrs)' },
  { id: 'pregnant_lactating', label: 'Pregnant / Lactating' },
];

export default function ScanScreen({ navigation }) {
  const [imageUri, setImageUri] = useState(null);
  const [ingredientsUri, setIngredientsUri] = useState(null);
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [ageGroup, setAgeGroup] = useState('adults_children_4plus');
  const [busy, setBusy] = useState(false);

  const toggleCondition = (id) => {
    setSelectedConditions((prev) => (
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    ));
  };

  const pickImage = async (setter, fromCamera) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Please allow access to continue.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

    if (!result.canceled && result.assets?.length) {
      setter(result.assets[0].uri);
    }
  };

  const handleAnalyze = async () => {
    if (!imageUri) {
      Alert.alert('No photo', 'Please take or choose a photo of the nutrition label first.');
      return;
    }
    setBusy(true);
    try {
      const data = await analyzeLabel(imageUri, selectedConditions, ingredientsUri, ageGroup);
      navigation.navigate('Results', { result: data });
    } catch (err) {
      const msg = err?.response?.data?.error
        || 'Analysis failed. The server may be waking up from sleep — try again in a moment.';
      Alert.alert('Analysis failed', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Scan a Food Label</Text>

      <View style={styles.photoBox}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.photoPreview} />
        ) : (
          <Text style={styles.photoPlaceholder}>No photo selected</Text>
        )}
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage(setImageUri, true)}>
          <Text style={styles.secondaryButtonText}>📷 Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage(setImageUri, false)}>
          <Text style={styles.secondaryButtonText}>🖼 Gallery</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Ingredients photo (optional)</Text>
      <Text style={styles.helpText}>
        Add a separate close-up if the ingredients list isn't visible in the main photo.
      </Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage(setIngredientsUri, true)}>
          <Text style={styles.secondaryButtonText}>📷 Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage(setIngredientsUri, false)}>
          <Text style={styles.secondaryButtonText}>🖼 Gallery</Text>
        </TouchableOpacity>
      </View>
      {ingredientsUri ? <Text style={styles.helpText}>✓ Ingredients photo added</Text> : null}

      <Text style={styles.sectionLabel}>Age / life-stage group</Text>
      <Text style={styles.helpText}>
        Changes which official Daily Values (%DV) are used — a toddler and an adult have different targets for the same nutrient.
      </Text>
      <View style={styles.chipsWrap}>
        {AGE_GROUPS.map((g) => {
          const active = ageGroup === g.id;
          return (
            <TouchableOpacity
              key={g.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setAgeGroup(g.id)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{g.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Your health profile (optional)</Text>
      <View style={styles.chipsWrap}>
        {CONDITIONS.map((c) => {
          const active = selectedConditions.includes(c.id);
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => toggleCondition(c.id)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={handleAnalyze} disabled={busy}>
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.primaryButtonText}>Analyze Label</Text>}
      </TouchableOpacity>
      {busy && (
        <Text style={styles.helpText}>
          Running OCR + health analysis — this can take up to a minute if the server was asleep.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60, backgroundColor: '#fff' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  photoBox: {
    height: 220, borderRadius: 12, borderWidth: 1, borderColor: '#ddd',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12, overflow: 'hidden', backgroundColor: '#fafafa',
  },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { color: '#999' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  secondaryButton: {
    flex: 1, borderWidth: 1, borderColor: '#2e7d32', borderRadius: 10, padding: 12, alignItems: 'center',
  },
  secondaryButtonText: { color: '#2e7d32', fontWeight: '600' },
  sectionLabel: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  helpText: { fontSize: 12, color: '#777', marginBottom: 10 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  chip: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  chipText: { color: '#444', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  primaryButton: {
    backgroundColor: '#2e7d32', borderRadius: 10, padding: 16, alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
