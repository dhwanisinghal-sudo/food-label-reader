# Food Label Reader — Mobile App (React Native / Expo)

This is the **native mobile frontend** for the Food Label Reader project.
It does **not** duplicate any backend logic — it's a client for the existing
Express + MongoDB Atlas backend already deployed here:

```
https://food-label-reader-1.onrender.com
```

All OCR, nutrition parsing, health scoring, and barcode/OpenFoodFacts
lookups still happen on that server, exactly as in the web version. This
app just gives you a real installable phone app on top of it.

## What's included

- Login / Signup (JWT auth, same as the web app)
- Scan screen — take a photo (or pick from gallery) of a food label,
  optional second photo for ingredients, select health conditions
- Results screen — health score, nutrition facts, allergens, additives,
  diet compatibility, barcode/OpenFoodFacts product lookup
- History screen — past scans pulled from `/api/history`

## Prerequisites

- [Node.js](https://nodejs.org) (LTS version)
- The **Expo Go** app on your phone — [iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)
- Your phone and computer on the **same Wi-Fi network**

## How to run it

1. Unzip this project and open a terminal inside the folder.
2. Install dependencies:
   ```
   npm install
   ```
3. Start the Expo dev server:
   ```
   npx expo start
   ```
4. A QR code will appear in the terminal / browser tab.
   - **Android:** open the Expo Go app → Scan QR Code
   - **iOS:** open your phone's Camera app → point at the QR code → tap the banner
5. The app will load on your phone. First load may take ~30–60 seconds
   the first time you hit the backend, since it's on Render's free tier
   and sleeps when idle.

## Notes

- `services/api.js` has the backend URL (`BASE_URL`) — change this if you
  ever redeploy the backend elsewhere.
- This app was built to match the tech stack originally planned on the
  project slides (React Native), while reusing the already-working,
  already-deployed backend rather than rebuilding it.
- To eventually publish this as a real app-store app, you'd run
  `eas build` (Expo's build service) — that step wasn't done here since
  it requires an Apple Developer / Google Play account.
