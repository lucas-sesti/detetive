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
  if (auth.currentUser) {
    console.log("[firebase] auth: already signed in uid=", auth.currentUser.uid);
    return;
  }
  console.log("[firebase] auth: signing in anonymously...");
  const cred = await signInAnonymously(auth);
  console.log("[firebase] auth: signed in uid=", cred.user.uid);
}

export function subscribeToRoomState(
  roomId: string,
  playerId: string,
  onState: (state: GameState) => void,
  onError: (err: Error) => void
): () => void {
  const path = `rooms/${roomId}/players/${playerId}/state/current`;
  console.log("[firebase] subscribeToRoomState path:", path);
  const ref = doc(db, "rooms", roomId, "players", playerId, "state", "current");
  return onSnapshot(ref, snap => {
    console.log("[firebase] snapshot received, exists:", snap.exists(), "path:", snap.ref.path);
    if (snap.exists()) {
      console.log("[firebase] state phase:", (snap.data() as GameState).phase);
      onState(snap.data() as GameState);
    } else {
      console.warn("[firebase] snapshot exists=false for path:", snap.ref.path);
    }
  }, err => {
    console.error("[firebase] onSnapshot error:", err.code, err.message);
    onError(err);
  });
}

export function subscribeToMessages(
  roomId: string,
  playerId: string,
  onMessages: (msgs: { type: string; data: unknown }[]) => void,
  onError: (err: Error) => void
): () => void {
  const ref = doc(db, "rooms", roomId, "messages", playerId);
  console.log("[firebase] subscribeToMessages path:", ref.path);
  return onSnapshot(ref, snap => {
    console.log("[firebase] messages snapshot received, exists:", snap.exists());
    const data = snap.data();
    if (data?.messages?.length) onMessages(data.messages);
  }, err => {
    console.error("[firebase] messages onSnapshot error:", err.code, err.message);
    onError(err);
  });
}
