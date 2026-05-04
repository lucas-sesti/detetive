# Realtime Vercel Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Firebase client SDK in Vercel Functions with Admin SDK, and replace client-side polling with Firestore `onSnapshot` for real-time state updates.

**Architecture:** Backend Vercel Functions use Firebase Admin SDK (service account, bypasses Security Rules) to write per-player scrubbed state documents and message documents. The React client subscribes to its own state document and messages document via `onSnapshot` after signing in anonymously. Only the host continues to poll `/api/tick` every second.

**Tech Stack:** Firebase Admin SDK (`firebase-admin`), Firebase client SDK (`firebase/app`, `firebase/firestore`, `firebase/auth`), Vercel Serverless Functions, React, TypeScript.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `api/_db.ts` | Modify | Switch to Admin SDK, add `saveScrubbedStateForAll`, `pushMessage`, `clearMessages` |
| `api/tick.ts` | Modify | Call `saveScrubbedStateForAll`, return `{ ok: true }` |
| `api/action.ts` | Modify | Call `saveScrubbedStateForAll`, use `pushMessage` for per-player messages |
| `api/create_room.ts` | Modify | Call `saveScrubbedStateForAll`, return `{ ok: true, roomId }` |
| `api/join_room.ts` | Modify | Call `saveScrubbedStateForAll`, return `{ ok: true, roomId }` |
| `api/clear_messages.ts` | Create | POST endpoint to delete player messages document |
| `api/state/[roomId].ts` | Delete | No longer needed |
| `src/lib/firebase.ts` | Create | Client Firebase init, `initAuth`, `subscribeToRoomState`, `subscribeToMessages` |
| `src/lib/api.ts` | Modify | Remove `getState`, add `clearMessages`, update `tick`/`createRoom`/`joinRoom` return types |
| `src/App.tsx` | Modify | Replace polling `useEffect` with `onSnapshot` subscriptions, call `initAuth` on join/create |
| `src/lib/socket.ts` | Delete | Unused |
| `package.json` | Modify | Remove `socket.io`, `socket.io-client` |
| `firebase.json` | Modify | Add Firestore Security Rules config |

---

## Task 1: Switch `api/_db.ts` to Firebase Admin SDK

**Files:**
- Modify: `api/_db.ts`

- [ ] **Step 1: Replace `_db.ts` with Admin SDK implementation**

Replace the entire file content:

```ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Volumes/Shared/Projects/detetive && npx tsc --noEmit
```

Expected: no errors from `api/_db.ts`. Ignore unrelated errors from other files for now.

- [ ] **Step 3: Commit**

```bash
git add api/_db.ts
git commit -m "feat: switch api/_db.ts to Firebase Admin SDK"
```

---

## Task 2: Update `api/tick.ts` and `api/action.ts`

**Files:**
- Modify: `api/tick.ts`
- Modify: `api/action.ts`

- [ ] **Step 1: Update `api/tick.ts`**

Replace entire file:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, saveScrubbedStateForAll } from "./_db.js";
import { runTick } from "./_game.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: "Missing roomId" });

  const room = await getRoom(roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: "Not found" });

  const updated = await runTick(room);
  await saveScrubbedStateForAll(updated);
  res.json({ ok: true });
}
```

- [ ] **Step 2: Update `api/action.ts`**

The action handler currently returns `{ ok: true, state: scrubStateFor(room, playerId) }` at the end. It also embeds notification data directly into player objects (which `saveScrubbedStateForAll` already copies per-player). We need to:
1. Replace `saveRoom` calls that are the final write with `saveScrubbedStateForAll`
2. Extract SNOOP result as a `pushMessage` call (it currently relies on the in-memory `playerMessages` map which no longer exists)
3. Return `{ ok: true }` at the end

Replace the entire `api/action.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, saveRoom, deleteRoom, scrubStateFor, saveScrubbedStateForAll, pushMessage } from "./_db.js";
import { GamePhase, Role, Item, Player, SecretActionType, SecretActionPayload } from "../src/types.js";
import { AVATARS, ITEMS_POOL, refreshGossipQuestions, startPhase, processGossipQuestion, nextGossipStep, REVEAL_TIMER } from "./_game.js";

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const playerId = req.headers["x-player-id"] as string;
  const { roomId, type, payload } = req.body;
  if (!roomId || !type) return res.status(400).json({ error: "Missing fields" });

  const room = await getRoom(roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: "Room not found" });

  const me = room.players.find(p => p.id === playerId);

  switch (type) {
    case "add_bot": {
      if (!me?.isHost || room.phase !== GamePhase.LOBBY || room.players.length >= 8) break;
      const avail = AVATARS.filter(a => !room.players.map(p => p.avatar).includes(a));
      if (!avail.length) break;
      const names = ["Benoit","Marta","Ransom","Linda","Richard","Joni","Walt","Jacob","Harlan","Meg","Fran","Alan"]
        .filter(n => !room.players.some(p => p.nickname.startsWith(n)));
      const nick = names.length ? `${pick(names)} (Bot)` : `Invitado ${Math.floor(Math.random() * 999)} (Bot)`;
      room.players.push({
        id: `bot_${Math.random().toString(36).substring(2, 7)}`, nickname: nick,
        avatar: pick(avail), isHost: false, isAlive: true,
        canPerformSecretAction: false, isIncriminated: false, roleRevealed: true, itemVisible: false, logs: [],
      });
      await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "reveal_role": {
      if (room.phase !== GamePhase.REVEAL || !me) break;
      me.roleRevealed = true; me.itemVisible = true;
      if (room.players.filter(p => !p.id.startsWith("bot_")).every(p => p.roleRevealed) && room.timer > 5) room.timer = 5;
      await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "start_game": {
      if (!me?.isHost || room.phase !== GamePhase.LOBBY) break;
      if (room.players.length < 4) { res.json({ ok: false, error: "¡Mínimo de 4 jugadores para comenzar!" }); return; }
      const killerCount = room.players.length > 4 ? 2 : 1;
      const shuffled = [...Array(room.players.length).keys()].sort(() => Math.random() - 0.5);
      room.players.forEach((p, i) => {
        p.role = shuffled.slice(0, killerCount).includes(i) ? Role.KILLER : Role.INNOCENT;
        p.item = pick(ITEMS_POOL); p.hasKnife = p.role === Role.KILLER;
        p.isAlive = true; p.isIncriminated = false; p.roleRevealed = false;
        p.itemVisible = false; p.usedPlantEvidence = false; p.logs = [];
      });
      const killers = room.players.filter(p => p.role === Role.KILLER);
      if (killers.length > 1) {
        killers.forEach(k => {
          const msg = `Tu cómplice asesino es: ${killers.filter(o => o.id !== k.id).map(o => o.nickname).join(", ")}. ¡Trabajad juntos!`;
          k.logs.push(msg); k.notification = { message: msg, type: "incriminated" };
        });
      }
      room.questionIndex = 0; room.roundCount = 1; room.interrogationIndex = 0;
      room.hasTriggeredRandomEvent = false; room.gossipResults = [];
      refreshGossipQuestions(room);
      await startPhase(room, GamePhase.REVEAL, REVEAL_TIMER);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "gossip_vote": {
      if ((room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2) || !me?.isAlive) break;
      const targetId = payload?.targetId;
      if (!targetId || targetId === playerId) break;
      me.gossipVote = targetId;
      room.players.filter(p => p.id.startsWith("bot_") && p.isAlive && !p.gossipVote).forEach(b => {
        const o = room.players.filter(x => x.id !== b.id && x.isAlive);
        if (o.length) b.gossipVote = pick(o).id;
      });
      const allVoted = room.players.filter(p => !p.id.startsWith("bot_") && p.isAlive).every(p => p.gossipVote);
      if (allVoted && !room.isSecretActionWindow) await processGossipQuestion(room);
      else await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "secret_action": {
      if (room.phase !== GamePhase.GOSSIP || !me?.canPerformSecretAction) break;
      const p = payload as SecretActionPayload;
      const t1 = room.players.find(x => x.id === p.targetId1);
      const t2 = room.players.find(x => x.id === p.targetId2);

      const swapItems = (a: Player, b: Player) => {
        const tmp = a.item; a.item = b.item; b.item = tmp;
        [a, b].forEach(pl => {
          if (!pl.id.startsWith("bot_")) {
            const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${pl.item}`;
            if (!pl.logs) pl.logs = []; pl.logs.push(msg);
            pl.notification = { message: msg, type: "swapped" };
          }
        });
      };

      switch (p.type) {
        case SecretActionType.SNOOP:
          if (t1) {
            const item = (t1.hasKnife || t1.item === Item.KNIFE) ? Item.KNIFE : t1.item;
            if (!me.logs) me.logs = [];
            me.logs.push(`Husmeando: ${t1.nickname} tiene ${item}`);
            await pushMessage(room.roomId, playerId, "snoop_result", { targetId: t1.id, item });
          }
          break;
        case SecretActionType.STEAL:
          if (t1) {
            const old = me.item; me.item = t1.item; t1.item = old;
            if (!me.logs) me.logs = []; me.logs.push(`¡Robaste el objeto de ${t1.nickname}! Ahora tienes: ${me.item}`);
            if (!t1.id.startsWith("bot_")) {
              const msg = `¡Tu objeto fue robado! Ahora tienes: ${t1.item}`;
              if (!t1.logs) t1.logs = []; t1.logs.push(msg);
              t1.notification = { message: msg, type: "stolen" };
            }
          }
          break;
        case SecretActionType.SWAP:
          if (t1) { swapItems(me, t1); if (!me.logs) me.logs = []; me.logs.push(`Intercambiaste tu objeto con ${t1.nickname}`); }
          break;
        case SecretActionType.SHUFFLE:
          if (t1 && t2) { swapItems(t1, t2); if (!me.logs) me.logs = []; me.logs.push(`Mezclaste los objetos de ${t1.nickname} y ${t2.nickname}`); }
          break;
        case SecretActionType.ALIBI:
          if (t1) {
            const a = `Coartada confirmada con ${t1.nickname}.`;
            const b = `${me.nickname} confirmó una coartada contigo.`;
            if (!me.logs) me.logs = []; me.logs.push(a);
            me.notification = { message: a, type: "swapped" };
            if (!t1.id.startsWith("bot_")) { if (!t1.logs) t1.logs = []; t1.logs.push(b); t1.notification = { message: b, type: "swapped" }; }
          }
          break;
        case SecretActionType.PLANT_EVIDENCE:
          if (t1 && me.hasKnife && !me.usedPlantEvidence) {
            t1.isIncriminated = true; t1.item = Item.KNIFE; me.usedPlantEvidence = true;
            if (!me.logs) me.logs = []; me.logs.push(`¡Incriminaste a ${t1.nickname}!`);
            if (!t1.id.startsWith("bot_")) {
              if (!t1.logs) t1.logs = []; t1.logs.push("¡Alguien plantó pruebas contra ti!");
              t1.notification = { message: "¡Alguien plantó pruebas contra ti!", type: "incriminated" };
            }
          }
          break;
        case SecretActionType.SKIP:
          if (me.assignedSecretAction === SecretActionType.PLANT_EVIDENCE) {
            if (!me.logs) me.logs = []; me.logs.push("Decidiste no actuar en este momento.");
          }
          break;
      }
      me.canPerformSecretAction = false;
      await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "skip_interrogation": {
      if (!me?.isAlive) break;
      if (room.phase === GamePhase.INTERROGATION) {
        if (!room.isInterrogationQuestionWindow && playerId === room.gossipResults[room.interrogationIndex]?.mostVotedId) {
          room.timer = 0; await saveRoom(room); await saveScrubbedStateForAll(room);
        }
        break;
      }
      me.isReadyToSkip = true;
      const alive1 = room.players.filter(p => !p.id.startsWith("bot_") && p.isAlive);
      if (alive1.every(p => p.isReadyToSkip)) {
        if (room.isSecretActionWindow) await nextGossipStep(room);
        else {
          room.players.filter(p => p.id.startsWith("bot_") && p.isAlive && !p.gossipVote).forEach(b => {
            const o = room.players.filter(x => x.id !== b.id && x.isAlive);
            if (o.length) b.gossipVote = pick(o).id;
          });
          await processGossipQuestion(room);
        }
      } else await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "skip_gossip": {
      if (!me?.isAlive || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) break;
      me.isReadyToSkip = true;
      const alive2 = room.players.filter(p => !p.id.startsWith("bot_") && p.isAlive);
      if (alive2.every(p => p.isReadyToSkip)) {
        if (room.isSecretActionWindow) await nextGossipStep(room);
        else {
          room.players.filter(p => p.id.startsWith("bot_") && p.isAlive && !p.gossipVote).forEach(b => {
            const o = room.players.filter(x => x.id !== b.id && x.isAlive);
            if (o.length) b.gossipVote = pick(o).id;
          });
          await processGossipQuestion(room);
        }
      } else await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "toggle_item_exposure":
      if (me) { me.itemExposed = !me.itemExposed; await saveRoom(room); await saveScrubbedStateForAll(room); }
      break;

    case "clear_notification":
      if (me) { me.notification = null; await saveRoom(room); await saveScrubbedStateForAll(room); }
      break;

    case "vote": {
      if (room.phase !== GamePhase.VOTING || !me?.isAlive || me.hasLockedVote) break;
      const t = payload?.targetId;
      if (t && t !== playerId) { me.votedFor = t; await saveRoom(room); await saveScrubbedStateForAll(room); }
      break;
    }

    case "lock_vote": {
      if (room.phase !== GamePhase.VOTING || !me?.isAlive || me.hasLockedVote) break;
      const t = payload?.targetId;
      if (!t || t === playerId || !room.players.find(p => p.id === t)?.isAlive) break;
      me.votedFor = t; me.hasLockedVote = true;
      room.players.filter(p => p.id.startsWith("bot_") && p.isAlive && !p.hasLockedVote).forEach(b => {
        const o = room.players.filter(x => x.id !== b.id && x.isAlive);
        if (o.length) { b.votedFor = pick(o).id; b.hasLockedVote = true; }
      });
      if (room.players.filter(p => p.isAlive).every(p => p.hasLockedVote)) room.timer = 0;
      await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }

    case "leave": {
      room.players = room.players.filter(p => p.id !== playerId);
      if (!room.players.length) { await deleteRoom(room.roomId); res.json({ ok: true }); return; }
      if (!room.players.some(p => p.isHost)) {
        const newHost = room.players.find(p => !p.id.startsWith("bot_"));
        if (newHost) newHost.isHost = true; else { await deleteRoom(room.roomId); res.json({ ok: true }); return; }
      }
      await saveRoom(room);
      await saveScrubbedStateForAll(room);
      break;
    }
  }

  res.json({ ok: true });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add api/tick.ts api/action.ts
git commit -m "feat: use saveScrubbedStateForAll in tick and action endpoints"
```

---

## Task 3: Update `api/create_room.ts`, `api/join_room.ts`, create `api/clear_messages.ts`

**Files:**
- Modify: `api/create_room.ts`
- Modify: `api/join_room.ts`
- Create: `api/clear_messages.ts`

- [ ] **Step 1: Update `api/create_room.ts`**

Replace entire file:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { saveRoom, saveScrubbedStateForAll } from "./_db.js";
import { GamePhase, Player, GameState } from "../src/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const playerId = req.headers["x-player-id"] as string;
  const { nickname, avatar } = req.body;
  if (!playerId || !nickname || !avatar) return res.status(400).json({ error: "Missing fields" });

  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const host: Player = {
    id: playerId, nickname, avatar, isHost: true, isAlive: true,
    canPerformSecretAction: false, isIncriminated: false, roleRevealed: false, itemVisible: false, logs: [],
  };
  const state: GameState = {
    roomId, phase: GamePhase.LOBBY, players: [host],
    timer: 0, roundCount: 1, questionIndex: 0, gossipResults: [], interrogationIndex: 0,
  };
  await saveRoom(state);
  await saveScrubbedStateForAll(state);
  res.json({ ok: true, roomId });
}
```

- [ ] **Step 2: Update `api/join_room.ts`**

Replace entire file:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, saveRoom, saveScrubbedStateForAll } from "./_db.js";
import { Player } from "../src/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const playerId = req.headers["x-player-id"] as string;
  const { roomId, nickname, avatar } = req.body;
  if (!playerId || !roomId || !nickname || !avatar) return res.status(400).json({ error: "Missing fields" });

  const room = await getRoom(roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.players.length >= 8) return res.status(400).json({ error: "Room is full" });

  if (!room.players.find(p => p.id === playerId)) {
    const player: Player = {
      id: playerId, nickname, avatar, isHost: false, isAlive: true,
      canPerformSecretAction: false, isIncriminated: false, roleRevealed: false, itemVisible: false, logs: [],
    };
    room.players.push(player);
    await saveRoom(room);
    await saveScrubbedStateForAll(room);
  }

  res.json({ ok: true, roomId: room.roomId });
}
```

- [ ] **Step 3: Create `api/clear_messages.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearMessages } from "./_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { roomId, playerId } = req.body;
  if (!roomId || !playerId) return res.status(400).json({ error: "Missing fields" });

  await clearMessages(roomId.toUpperCase(), playerId);
  res.json({ ok: true });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add api/create_room.ts api/join_room.ts api/clear_messages.ts
git commit -m "feat: update create/join to use saveScrubbedStateForAll, add clear_messages endpoint"
```

---

## Task 4: Delete unused files, remove socket.io dependencies

**Files:**
- Delete: `api/state/[roomId].ts`
- Delete: `src/lib/socket.ts`
- Modify: `package.json`

- [ ] **Step 1: Delete unused files**

```bash
rm /Volumes/Shared/Projects/detetive/api/state/\[roomId\].ts
rm /Volumes/Shared/Projects/detetive/src/lib/socket.ts
```

- [ ] **Step 2: Remove socket.io from package.json**

In `package.json`, remove these two entries from `"dependencies"`:
- `"socket.io": "^4.8.3"`
- `"socket.io-client": "^4.8.3"`

Then run:

```bash
npm uninstall socket.io socket.io-client
```

Expected: `package.json` and `package-lock.json` updated, `node_modules/socket.io*` removed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove socket.io and unused state endpoint"
```

---

## Task 5: Create `src/lib/firebase.ts`

**Files:**
- Create: `src/lib/firebase.ts`

- [ ] **Step 1: Create the file**

```ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase.ts
git commit -m "feat: add firebase client lib with onSnapshot subscriptions"
```

---

## Task 6: Update `src/lib/api.ts`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Replace `api.ts`**

```ts
import { GameState, Item } from '../types';

let _playerId: string | null = null;

export function getPlayerId(): string {
  if (_playerId) return _playerId;
  let id = localStorage.getItem('playerId');
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('playerId', id);
  }
  _playerId = id;
  return id;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-player-id': getPlayerId() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  createRoom: (nickname: string, avatar: string) =>
    post<{ ok: boolean; roomId: string }>('/api/create_room', { nickname, avatar }),

  joinRoom: (roomId: string, nickname: string, avatar: string) =>
    post<{ ok: boolean; roomId: string }>('/api/join_room', { roomId, nickname, avatar }),

  tick: (roomId: string): Promise<{ ok: boolean }> =>
    post('/api/tick', { roomId }),

  action: (roomId: string, type: string, payload?: unknown): Promise<{ ok: boolean }> =>
    post('/api/action', { roomId, type, payload }),

  clearMessages: (roomId: string, playerId: string): Promise<{ ok: boolean }> =>
    post('/api/clear_messages', { roomId, playerId }),
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors (there will be errors in `App.tsx` until that's updated — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: update api.ts to match new endpoint contracts"
```

---

## Task 7: Update `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add firebase imports to `src/App.tsx`**

At the top of `src/App.tsx`, after the existing imports, add:

```ts
import { initAuth, subscribeToRoomState, subscribeToMessages } from './lib/firebase';
```

- [ ] **Step 2: Replace the polling `useEffect` (lines 455–469)**

Find and replace this block:

```ts
    useEffect(() => {
        if (!roomIdRef.current) return;
        const interval = setInterval(async () => {
            try {
                if (isHostRef.current && roomIdRef.current) {
                    const res = await api.tick(roomIdRef.current);
                    if (res) applyState(res.state);
                } else {
                    const res = await api.getState(roomIdRef.current!);
                    if (res) { handleMessages(res.messages ?? []); applyState(res.state); }
                }
            } catch {}
        }, 1000);
        return () => clearInterval(interval);
    }, [roomIdRef.current]);
```

With:

```ts
    useEffect(() => {
        if (!roomIdRef.current) return;

        const unsubState = subscribeToRoomState(
            roomIdRef.current,
            playerId,
            state => applyState(state),
            () => {}
        );

        const unsubMessages = subscribeToMessages(
            roomIdRef.current,
            playerId,
            msgs => {
                handleMessages(msgs);
                api.clearMessages(roomIdRef.current!, playerId).catch(() => {});
            },
            () => {}
        );

        let tickInterval: ReturnType<typeof setInterval> | null = null;
        if (isHostRef.current) {
            tickInterval = setInterval(() => {
                api.tick(roomIdRef.current!).catch(() => {});
            }, 1000);
        }

        return () => {
            unsubState();
            unsubMessages();
            if (tickInterval) clearInterval(tickInterval);
        };
    }, [roomIdRef.current]);
```

- [ ] **Step 3: Update `handleCreateRoom` to call `initAuth` and use new return type**

Find:

```ts
    const handleCreateRoom = async () => {
        if (!nickname) { setError("Por favor, introduce un nombre"); return; }
        try {
            const state = await api.createRoom(nickname, selectedAvatar);
            roomIdRef.current = state.roomId;
            isHostRef.current = true;
            setGameState(state);
        } catch (e: any) { setError(e.message); }
    };
```

Replace with:

```ts
    const handleCreateRoom = async () => {
        if (!nickname) { setError("Por favor, introduce un nombre"); return; }
        try {
            await initAuth();
            const res = await api.createRoom(nickname, selectedAvatar);
            isHostRef.current = true;
            roomIdRef.current = res.roomId;
        } catch (e: any) { setError(e.message); }
    };
```

- [ ] **Step 4: Update `handleJoinRoom` to call `initAuth` and use new return type**

Find:

```ts
    const handleJoinRoom = async () => {
        if (!nickname || !roomIdInput) { setError("Introduce tu nombre y el código de la sala"); return; }
        try {
            const state = await api.joinRoom(roomIdInput, nickname, selectedAvatar);
            roomIdRef.current = state.roomId;
            isHostRef.current = false;
            setGameState(state);
        } catch (e: any) { setError(e.message); }
    };
```

Replace with:

```ts
    const handleJoinRoom = async () => {
        if (!nickname || !roomIdInput) { setError("Introduce tu nombre y el código de la sala"); return; }
        try {
            await initAuth();
            const res = await api.joinRoom(roomIdInput, nickname, selectedAvatar);
            isHostRef.current = false;
            roomIdRef.current = res.roomId;
        } catch (e: any) { setError(e.message); }
    };
```

- [ ] **Step 5: Update `action` helper to not use returned state**

Find:

```ts
    const action = (type: string, payload?: unknown) => {
        if (!roomIdRef.current) return;
        api.action(roomIdRef.current, type, payload)
            .then(res => { if (res?.state) applyState(res.state); })
            .catch(() => {});
    };
```

Replace with:

```ts
    const action = (type: string, payload?: unknown) => {
        if (!roomIdRef.current) return;
        api.action(roomIdRef.current, type, payload).catch(() => {});
    };
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace polling with Firestore onSnapshot in App.tsx"
```

---

## Task 8: Configure Firestore Security Rules

**Files:**
- Modify: `firebase.json`

- [ ] **Step 1: Create `firestore.rules`**

Create the file `/Volumes/Shared/Projects/detetive/firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId}/players/{playerId}/state/current {
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

- [ ] **Step 2: Update `firebase.json` to reference the rules file**

Replace the contents of `firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

- [ ] **Step 3: Create empty indexes file (required by Firebase CLI)**

```bash
echo '{"indexes":[],"fieldOverrides":[]}' > /Volumes/Shared/Projects/detetive/firestore.indexes.json
```

- [ ] **Step 4: Deploy Security Rules to Firebase**

```bash
npx firebase deploy --only firestore:rules --project second-terrain-406121
```

Expected: `Deploy complete!`

If Firebase CLI is not installed or not authenticated:

```bash
npm install -g firebase-tools
firebase login
npx firebase deploy --only firestore:rules --project second-terrain-406121
```

- [ ] **Step 5: Commit**

```bash
git add firebase.json firestore.rules firestore.indexes.json
git commit -m "feat: add Firestore security rules for per-player state/messages"
```

---

## Task 9: Add `FIREBASE_SERVICE_ACCOUNT` to Vercel and build frontend

**Files:** none (environment + build verification)

- [ ] **Step 1: Generate service account JSON in Firebase Console**

1. Go to Firebase Console → Project `second-terrain-406121` → Project Settings → Service Accounts
2. Click "Generate new private key" → Download JSON
3. Copy the entire JSON content (single line)

- [ ] **Step 2: Add to Vercel environment variables**

```bash
vercel env add FIREBASE_SERVICE_ACCOUNT production
```

When prompted, paste the full service account JSON as the value.

Or via Vercel dashboard: Settings → Environment Variables → add `FIREBASE_SERVICE_ACCOUNT` with the JSON value.

- [ ] **Step 3: Build the frontend locally to verify no compile errors**

```bash
npm run build
```

Expected: Vite build succeeds, `dist/` directory populated.

- [ ] **Step 4: Commit and push to trigger Vercel deploy**

```bash
git push origin main
```

Expected: Vercel picks up the push and deploys. Check Vercel dashboard for build status.

---

## Task 10: Smoke test on Vercel

After deploy completes:

- [ ] **Step 1: Test `create_room` endpoint**

```bash
curl -s -X POST https://<your-vercel-domain>/api/create_room \
  -H "Content-Type: application/json" \
  -H "x-player-id: test-player-1" \
  -d '{"nickname":"Benoit","avatar":"lucas"}' | jq .
```

Expected:
```json
{ "ok": true, "roomId": "XXXXXX" }
```

- [ ] **Step 2: Test `join_room` endpoint with the returned roomId**

```bash
curl -s -X POST https://<your-vercel-domain>/api/join_room \
  -H "Content-Type: application/json" \
  -H "x-player-id: test-player-2" \
  -d '{"roomId":"XXXXXX","nickname":"Marta","avatar":"mel"}' | jq .
```

Expected:
```json
{ "ok": true, "roomId": "XXXXXX" }
```

- [ ] **Step 3: Verify Firestore documents in Firebase Console**

In Firebase Console → Firestore → `detetive` database:
- `rooms/XXXXXX` — raw state document exists
- `rooms/XXXXXX/players/test-player-1/state/current` — scrubbed state for player 1
- `rooms/XXXXXX/players/test-player-2/state/current` — scrubbed state for player 2

- [ ] **Step 4: Test `tick` endpoint**

```bash
curl -s -X POST https://<your-vercel-domain>/api/tick \
  -H "Content-Type: application/json" \
  -H "x-player-id: test-player-1" \
  -d '{"roomId":"XXXXXX"}' | jq .
```

Expected:
```json
{ "ok": true }
```

- [ ] **Step 5: Test full game flow in browser**

Open the Vercel URL in two browser tabs (or two devices). Create a room in one, join in the other. Verify both see the lobby update in real time without page refresh.
