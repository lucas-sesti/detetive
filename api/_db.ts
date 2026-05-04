import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { GameState } from "../src/types.js";

function getApp() {
  if (getApps().length) return getApps()[0];
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
  return initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore(getApp(), "detetive");

export async function getRoom(roomId: string): Promise<GameState | null> {
  const snap = await db.collection("rooms").doc(roomId).get();
  return snap.exists ? (snap.data() as GameState) : null;
}

export async function saveRoom(room: GameState) {
  await db.collection("rooms").doc(room.roomId).set(JSON.parse(JSON.stringify(room)));
}

export async function deleteRoom(roomId: string) {
  await db.collection("rooms").doc(roomId).delete();
}

export async function getAllRooms(): Promise<GameState[]> {
  const snap = await db.collection("rooms").get();
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

export async function saveScrubbedStateForAll(room: GameState) {
  const batch = db.batch();
  for (const player of room.players) {
    const ref = db.collection("rooms").doc(room.roomId)
      .collection("players").doc(player.id)
      .collection("state").doc("current");
    batch.set(ref, JSON.parse(JSON.stringify(scrubStateFor(room, player.id))));
  }
  await batch.commit();
}

export async function pushMessage(
  roomId: string,
  playerId: string,
  type: string,
  data: unknown
) {
  const ref = db.collection("rooms").doc(roomId)
    .collection("messages").doc(playerId);
  await ref.set(
    { messages: FieldValue.arrayUnion({ type, data }) },
    { merge: true }
  );
}

export async function clearMessages(roomId: string, playerId: string) {
  const ref = db.collection("rooms").doc(roomId)
    .collection("messages").doc(playerId);
  await ref.delete();
}
