import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import type { GameState } from "../src/types.js";

const firebaseConfig = {
  projectId: "second-terrain-406121",
  appId: "1:483233971300:web:dd87f4d18e6ff8832df371",
  apiKey: "AIzaSyCh_KTKdLbuCuEmP7BGB-pf74awPeRU4b8",
  authDomain: "second-terrain-406121.firebaseapp.com",
  storageBucket: "second-terrain-406121.firebasestorage.app",
  messagingSenderId: "483233971300",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app, "detetive");

export async function getRoom(roomId: string): Promise<GameState | null> {
  const snap = await getDoc(doc(db, "rooms", roomId));
  return snap.exists() ? (snap.data() as GameState) : null;
}

export async function saveRoom(room: GameState) {
  await setDoc(doc(db, "rooms", room.roomId), JSON.parse(JSON.stringify(room)));
}

export async function deleteRoom(roomId: string) {
  await deleteDoc(doc(db, "rooms", roomId));
}

export async function getAllRooms(): Promise<GameState[]> {
  const snap = await getDocs(collection(db, "rooms"));
  return snap.docs.map(d => d.data() as GameState);
}

export function scrubStateFor(room: GameState, playerId: string): GameState {
  const scrubbedPlayers = room.players.map(player => {
    const isOwner = player.id === playerId;
    const isGameOver = room.phase === "game_over";
    return {
      ...player,
      role: (isOwner || isGameOver) ? player.role : undefined,
      item: (isOwner || isGameOver || player.itemVisible) ? player.item : undefined,
      hasKnife: ((isOwner && player.hasKnife) || isGameOver) ? player.hasKnife : undefined,
      assignedSecretAction: isOwner ? player.assignedSecretAction : undefined,
      logs: isOwner ? player.logs : [],
      gossipVote: isOwner ? player.gossipVote : undefined,
      hasGossipVoted: !!player.gossipVote,
      votedFor: (isOwner || room.phase === "result" || isGameOver) ? player.votedFor : undefined,
      hasLockedVote: player.hasLockedVote,
    };
  });
  return { ...room, players: scrubbedPlayers };
}
