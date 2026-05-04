# Design: Realtime Architecture for Vercel — Firebase Admin SDK + Firestore onSnapshot

**Date:** 2026-05-04  
**Status:** Approved

---

## Problem

The current architecture uses the Firebase client SDK (`firebase/app`, `firebase/firestore`) inside Vercel serverless functions. This causes `permission-denied` errors because Firestore Security Rules block server-side client SDK calls that lack user auth context. Additionally, the client polls `/api/state` every 1s per player, generating excessive Vercel Function invocations.

---

## Solution Overview

- **Backend (Vercel Functions):** Replace Firebase client SDK with **Firebase Admin SDK** (`firebase-admin`). Admin SDK uses a service account with full Firestore access, bypassing Security Rules entirely.
- **Frontend (React client):** Replace `setInterval` polling of `/api/state` with **Firestore `onSnapshot`** listener — real-time push from Firestore to the client. Client authenticates anonymously via Firebase Anonymous Auth to satisfy Security Rules.
- **State privacy:** Each player gets their own scrubbed state document `rooms/{roomId}/players/{playerId}/state`, written by the backend after every action/tick.
- **Ephemeral messages:** Per-player messages (snoop_result, event_message, error) stored in `rooms/{roomId}/messages/{playerId}`, written by backend, consumed and cleared by client.

---

## Architecture

### Data Flow

```
[Client] POST /api/action → [Vercel Function] → Firestore (Admin SDK)
                                                  ├── writes rooms/{roomId} (raw state)
                                                  ├── writes rooms/{roomId}/players/{playerId}/state (scrubbed, per player)
                                                  └── writes rooms/{roomId}/messages/{playerId} (if any messages)

[Client] onSnapshot(rooms/{roomId}/players/{playerId}/state) ← Firestore push
[Client] onSnapshot(rooms/{roomId}/messages/{playerId})      ← Firestore push

[Host only] setInterval 1s → POST /api/tick → [Vercel Function] → Firestore (Admin SDK)
```

### Action Complete Flow

1. Client calls `POST /api/action { roomId, type, payload }`
2. Vercel Function: `getRoom` → applies game logic → saves raw state to `rooms/{roomId}`
3. For each player: writes `rooms/{roomId}/players/{playerId}/state` with scrubbed state (via `scrubStateFor`)
4. If messages exist for players: writes to `rooms/{roomId}/messages/{playerId}`
5. Returns `{ ok: true }` — no state in response body (client already receives via onSnapshot)
6. Firestore triggers `onSnapshot` on each connected client

---

## Components

### `api/_db.ts` (modified)

Replace Firebase client SDK with Firebase Admin SDK:

```ts
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
```

Initialize with service account from environment variable `FIREBASE_SERVICE_ACCOUNT` (JSON string). All existing function signatures (`getRoom`, `saveRoom`, `deleteRoom`, `getAllRooms`, `scrubStateFor`) remain unchanged.

Add two new functions:
- `saveScrubbedStateForAll(room: GameState)` — iterates all players, calls `scrubStateFor`, writes to `rooms/{roomId}/players/{playerId}/state`
- `pushMessage(roomId: string, playerId: string, type: string, data: unknown)` — appends to `rooms/{roomId}/messages/{playerId}` using `arrayUnion`

### `api/state/[roomId].ts` (deleted)

This endpoint is no longer needed. Clients receive state via `onSnapshot`.

### `api/tick.ts` (modified)

After `runTick`, call `saveScrubbedStateForAll(updated)` instead of relying on `saveRoom` alone. Return `{ ok: true }` instead of state.

### `api/action.ts` (modified)

After applying action, call `saveScrubbedStateForAll`. Write any messages via `pushMessage`. Return `{ ok: true }`.

### `api/create_room.ts` and `api/join_room.ts` (modified)

After saving room, call `saveScrubbedStateForAll`. Return `{ ok: true, roomId, playerId }`. The client saves `roomId` to `roomIdRef.current` and sets `isHostRef.current`, then calls `initAuth()` and starts the `onSnapshot` subscription — full state arrives via push shortly after.

### `src/lib/firebase.ts` (new file)

```ts
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import type { GameState } from "../types";

const firebaseConfig = { /* existing config */ };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "detetive");
const auth = getAuth(app);

export async function initAuth() {
  await signInAnonymously(auth);
}

export function subscribeToRoomState(
  roomId: string,
  playerId: string,
  onState: (state: GameState) => void,
  onError: (err: Error) => void
): () => void {
  const ref = doc(db, "rooms", roomId, "players", playerId, "state");
  return onSnapshot(ref, snap => { if (snap.exists()) onState(snap.data() as GameState); }, onError);
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
```

### `src/App.tsx` (modified)

Replace the polling `useEffect`:

```ts
// Before
useEffect(() => {
  if (!roomIdRef.current) return;
  const interval = setInterval(async () => {
    if (isHostRef.current) { /* tick */ } else { /* getState */ }
  }, 1000);
  return () => clearInterval(interval);
}, [roomIdRef.current]);

// After
useEffect(() => {
  if (!roomIdRef.current) return;

  const unsubState = subscribeToRoomState(
    roomIdRef.current, playerId,
    state => applyState(state),
    err => { /* show reconnect UI after 3s */ }
  );

  const unsubMessages = subscribeToMessages(
    roomIdRef.current, playerId,
    msgs => { handleMessages(msgs); api.clearMessages(roomIdRef.current!, playerId); },
    () => {}
  );

  // Host-only tick — isHostRef.current is already set before roomIdRef.current is assigned
  // (set in handleCreateRoom before setGameState triggers the effect)
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  if (isHostRef.current) {
    tickInterval = setInterval(() => api.tick(roomIdRef.current!), 1000);
  }

  return () => {
    unsubState();
    unsubMessages();
    if (tickInterval) clearInterval(tickInterval);
  };
}, [roomIdRef.current]);
```

Also: call `initAuth()` before `createRoom`/`joinRoom`.

### `api/clear_messages.ts` (new endpoint)

```ts
POST /api/clear_messages { roomId, playerId }
```

Deletes or empties the messages document for that player. Called by the client after consuming messages.

---

## Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/players/{playerId}/state {
      allow read: if request.auth != null;
      allow write: if false;
    }
    match /rooms/{roomId}/messages/{playerId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
    match /rooms/{roomId} {
      allow read, write: if false;
    }
  }
}
```

---

## Environment Variables

| Variable | Where | Value |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Vercel (server-side) | Full service account JSON as string |

Firebase client config keys remain hardcoded in `src/lib/firebase.ts` (public by design).

---

## Error Handling

- `onSnapshot` error callback: if `permission-denied`, display reconnect UI and retry after 3s
- `/api/action` HTTP errors: display inline error (existing behavior preserved)
- Host tick failure: timer freezes — visible to players as paused countdown, acceptable degradation
- `signInAnonymously` failure: block room creation/join with error message

---

## What Is Removed

- `src/lib/socket.ts` — delete (socket.io never actually connected)
- `socket.io` and `socket.io-client` npm dependencies — remove
- `api/state/[roomId].ts` — delete
- `playerMessages` in-memory Map from `api/state/[roomId].ts` — removed (replaced by Firestore messages subcollection)

---

## Out of Scope

- Changing game logic in `_game.ts`
- Changing types in `src/types.ts`
- Any UI changes
