/**
 * api.js
 * Talks to the EXISTING Food Label Reader backend (Express + MongoDB Atlas,
 * deployed on Render). This app does not reimplement any backend logic —
 * OCR, nutrition parsing, barcode scanning, and health scoring all still
 * happen server-side, exactly as in the web version.
 *
 * Change BASE_URL only if you redeploy the backend somewhere else.
 */

import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = 'https://food-label-reader-1.onrender.com';

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, // OCR + LLM analysis can take a while, especially on a
  // cold Render free-tier instance waking up from sleep.
});

// Attach the JWT (if we have one) to every request automatically.
client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function signup(email, password) {
  const { data } = await client.post('/api/signup', { email, password });
  await SecureStore.setItemAsync('token', data.token);
  await SecureStore.setItemAsync('email', data.user.email);
  return data;
}

export async function login(email, password) {
  const { data } = await client.post('/api/login', { email, password });
  await SecureStore.setItemAsync('token', data.token);
  await SecureStore.setItemAsync('email', data.user.email);
  return data;
}

export async function logout() {
  await SecureStore.deleteItemAsync('token');
  await SecureStore.deleteItemAsync('email');
}

export async function getStoredSession() {
  const token = await SecureStore.getItemAsync('token');
  const email = await SecureStore.getItemAsync('email');
  return token ? { token, email } : null;
}

/**
 * Uploads a label photo (and optional ingredients close-up photo) for
 * analysis, mirroring exactly what the web frontend's fetch() call does.
 *
 * @param {string} imageUri - local file:// URI from the image picker
 * @param {string[]} conditions - e.g. ['diabetes', 'high_bp']
 * @param {string} [ingredientsUri] - optional second photo
 * @param {string} [ageGroup] - 'adults_children_4plus' | 'children_1_3' | 'pregnant_lactating'
 */
export async function analyzeLabel(imageUri, conditions = [], ingredientsUri = null, ageGroup = 'adults_children_4plus') {
  const form = new FormData();
  form.append('image', {
    uri: imageUri,
    name: 'label.jpg',
    type: 'image/jpeg',
  });
  if (ingredientsUri) {
    form.append('ingredientsImage', {
      uri: ingredientsUri,
      name: 'ingredients.jpg',
      type: 'image/jpeg',
    });
  }
  form.append('conditions', JSON.stringify(conditions));
  form.append('ageGroup', ageGroup);

  const { data } = await client.post('/api/analyze', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function getHistory(limit = 20) {
  const { data } = await client.get('/api/history', { params: { limit } });
  return data;
}
