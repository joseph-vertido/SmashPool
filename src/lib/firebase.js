import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadString
} from 'firebase/storage';
import {
  buildAdminDashboardSnapshot,
  buildPublicDashboard,
  buildSettlementSnapshot,
  migrateState,
  safePhotoSrc
} from './pool.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'smashpool-d6818',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

export const firebaseMissingKeys = Object.entries(firebaseConfig)
  .filter(([key, value]) => !['messagingSenderId', 'storageBucket'].includes(key) && !value)
  .map(([key]) => key);

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app && firebaseConfig.storageBucket ? getStorage(app) : null;

const POOL_ID = import.meta.env.VITE_SMASHPOOL_POOL_ID || 'main';

function adminPoolRef() {
  return doc(db, 'adminPools', POOL_ID);
}

function publicPoolRef() {
  return doc(db, 'publicPools', POOL_ID);
}

export async function isAdminUser(uid) {
  if (!db || !uid) return false;
  const snapshot = await getDoc(doc(db, 'admins', uid));
  return snapshot.exists() && snapshot.data()?.active === true;
}

export async function loadAdminState() {
  if (!db) return null;
  const snapshot = await getDoc(adminPoolRef());
  return snapshot.exists() ? migrateState(snapshot.data()?.state ?? snapshot.data()) : null;
}

export async function saveAdminState(state) {
  if (!db) throw new Error('Firebase is not configured.');
  const cleanState = JSON.parse(JSON.stringify(state));
  const publicDashboard = buildPublicDashboard(cleanState);
  const batch = writeBatch(db);
  batch.set(adminPoolRef(), { state: cleanState, updatedAt: serverTimestamp() });
  batch.set(publicPoolRef(), { ...publicDashboard, updatedAt: serverTimestamp() });
  await batch.commit();
}

export function listenPublicDashboard(onData, onError) {
  if (!db) return () => {};
  return onSnapshot(publicPoolRef(), snapshot => {
    onData(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}



export async function archiveEvent(state, archivedBy = '') {
  if (!db) throw new Error('Firebase is not configured.');
  const cleanState = JSON.parse(JSON.stringify(migrateState(state)));
  const archivedAtIso = new Date().toISOString();
  const snapshot = {
    schemaVersion: 2,
    appVersion: '2.1.19',
    poolId: POOL_ID,
    tournamentName: cleanState.tournamentName,
    archivedBy: String(archivedBy || ''),
    archivedAtIso,
    archivedAt: serverTimestamp(),
    state: cleanState,
    dashboard: buildAdminDashboardSnapshot(cleanState),
    settlement: buildSettlementSnapshot(cleanState)
  };
  const reference = await addDoc(collection(db, 'eventArchives'), snapshot);
  return { id: reference.id, ...snapshot, archivedAt: null };
}

export async function loadEventArchives() {
  if (!db) return [];
  const snapshots = await getDocs(collection(db, 'eventArchives'));
  return snapshots.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
    .sort((a, b) => String(b.archivedAtIso || '').localeCompare(String(a.archivedAtIso || '')));
}

export async function uploadProfilePhoto(pairId, playerNumber, dataUrl) {
  if (!storage) return dataUrl;
  if (!safePhotoSrc(dataUrl) || !String(dataUrl).startsWith('data:image/')) {
    throw new Error('The selected image could not be prepared for upload.');
  }
  const photoRef = ref(storage, `profilePhotos/${POOL_ID}/${pairId}/player${playerNumber}.webp`);
  await uploadString(photoRef, dataUrl, 'data_url', { contentType: 'image/webp' });
  return getDownloadURL(photoRef);
}

export async function deleteProfilePhoto(pairId, playerNumber) {
  if (!storage) return;
  const photoRef = ref(storage, `profilePhotos/${POOL_ID}/${pairId}/player${playerNumber}.webp`);
  try {
    await deleteObject(photoRef);
  } catch (error) {
    if (error?.code !== 'storage/object-not-found') throw error;
  }
}

export async function migrateInlinePhotosToStorage(state) {
  const migrated = migrateState(state);
  const pairs = [];
  for (const pair of migrated.pairs) {
    const next = { ...pair };
    for (const player of [1, 2]) {
      const key = `player${player}Photo`;
      if (typeof next[key] === 'string' && next[key].startsWith('data:image/')) {
        next[key] = await uploadProfilePhoto(pair.id, player, next[key]);
      }
    }
    pairs.push(next);
  }
  return { ...migrated, pairs };
}
