import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import type { GameState } from "../types";

const firebaseConfig = {
  projectId: "second-terrain-406121",
  appId: "1:483233971300:web:dd87f4d18e6ff8832df371",
  apiKey: "AIzaSyCh_KTKdLbuCuEmP7BGB-pf74awPeRU4b8",
  authDomain: "second-terrain-406121.firebaseapp.com",
  storageBucket: "second-terrain-406121.firebasestorage.app",
  messagingSenderId: "483233971300",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app, "detetive");
const auth = getAuth(app);

export async function initAuth(): Promise<void> {
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}

export function subscribeToRoomState(
  roomId: string,
  playerId: string,
  onState: (state: GameState) => void,
  onError: (err: Error) => void
): () => void {
  const ref = doc(db, "rooms", roomId, "players", playerId, "state", "current");
  return onSnapshot(ref, snap => {
    if (snap.exists()) onState(snap.data() as GameState);
  }, onError);
}

export function subscribeToMessages(
  roomId: string,
  playerId: string,
  onMessages: (msgs: { type: string; data: unknown }[]) => void,
  onError: (err: Error) => void
): () => void {
  const ref = doc(db, "rooms", roomId, "messages", playerId);
  return onSnapshot(ref, snap => {
    const data = snap.data();
    if (data?.messages?.length) onMessages(data.messages);
  }, onError);
}
