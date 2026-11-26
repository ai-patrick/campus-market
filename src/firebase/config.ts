import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  type Firestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

// Track if we're using memory cache (persistence failed)
let usingMemoryCache = false;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

auth = getAuth(app);

// Initialize Firestore with modern cache config
// Try persistent cache first, fall back to memory cache if it fails
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (error) {
  console.warn('Persistent cache initialization failed, falling back to memory cache:', error);
  usingMemoryCache = true;

  // Clear potentially corrupted IndexedDB
  if (typeof window !== 'undefined' && 'indexedDB' in window) {
    try {
      indexedDB.deleteDatabase('firestore');
    } catch (e) {
      console.warn('Could not clear IndexedDB:', e);
    }
  }

  // Initialize with memory-only cache
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
}

// Connect to emulators in development
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// Export helper to check if persistence is available
export function isUsingMemoryCache(): boolean {
  return usingMemoryCache;
}

export { app, auth, db };