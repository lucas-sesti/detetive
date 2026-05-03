import express from "express";
import { createServer } from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import { GamePhase, Role, Item, Player, GameState, SecretActionType, SecretActionPayload } from "./src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = {
  projectId: "second-terrain-406121",
  appId: "1:483233971300:web:dd87f4d18e6ff8832df371",
  apiKey: "AIzaSyCh_KTKdLbuCuEmP7BGB-pf74awPeRU4b8",
  authDomain: "second-terrain-406121.firebaseapp.com",
  storageBucket: "second-terrain-406121.firebasestorage.app",
  messagingSenderId: "483233971300",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, "detetive");

const PORT = 3000;
const GOSSIP_TIMER = 300;
const REVEAL_TIMER = 10;
const INTRO_TIMER = 28;
const INTERROGATION_INTRO_TIMER = 20;
const VOTING_TIMER = 60;
const RESULT_TIMER = 15;
const AVATARS = ['bibs', 'gb', 'lavis', 'lucas', 'mat', 'mel', '🤵', '💃'];
const ITEMS_POOL = Object.values(Item).filter(i => i !== Item.KNIFE);

const QUESTIONS = [
  "¿Quién es el más probable de ser el asesino?",
  "¿Quién tiene la sonrisa más sospechosa?",
  "¿Quién es el más hablador?",
  "¿Quién está más callado?",
  "¿Quién está más agitado?"
];
const GOSSIP_2_QUESTIONS = [
  "¿Quién defendió más a un sospechoso?",
  "¿Quién discutió más durante la votación?",
  "¿Quién fue el más callado?",
  "¿Quién está actuando de forma sospechosa?"
];
const INTERROGATION_QUESTIONS = [
  "Cuéntanos lo que sabes",
  "¿Intercambiaste algún objeto?",
  "¿Robaste algún objeto?",
  "¿Incriminaste a alguien?"
];

// Per-player pending messages (replaces socket.emit to specific players)
const playerMessages = new Map<string, { type: string; data: unknown }[]>();

function pushMessage(playerId: string, type: string, data: unknown) {
  if (!playerMessages.has(playerId)) playerMessages.set(playerId, []);
  playerMessages.get(playerId)!.push({ type, data });
}

function flushMessages(playerId: string) {
  const msgs = playerMessages.get(playerId) ?? [];
  playerMessages.delete(playerId);
  return msgs;
}

async function saveRoom(room: GameState) {
  await setDoc(doc(db, "rooms", room.roomId), JSON.parse(JSON.stringify(room)));
}

async function getRoom(roomId: string): Promise<GameState | null> {
  const snap = await getDoc(doc(db, "rooms", roomId));
  return snap.exists() ? (snap.data() as GameState) : null;
}

async function deleteRoom(roomId: string) {
  await deleteDoc(doc(db, "rooms", roomId));
}

async function getAllRooms(): Promise<GameState[]> {
  const snap = await getDocs(collection(db, "rooms"));
  return snap.docs.map(d => d.data() as GameState);
}

function scrubStateFor(room: GameState, playerId: string): GameState {
  const scrubbedPlayers = room.players.map(player => {
    const isOwner = player.id === playerId;
    const showRole = isOwner || room.phase === GamePhase.GAME_OVER;
    const showItem = isOwner || room.phase === GamePhase.GAME_OVER || player.itemVisible;
    const showKnife = (isOwner && player.hasKnife) || room.phase === GamePhase.GAME_OVER;
    return {
      ...player,
      role: showRole ? player.role : undefined,
      item: showItem ? player.item : undefined,
      hasKnife: showKnife ? player.hasKnife : undefined,
      assignedSecretAction: isOwner ? player.assignedSecretAction : undefined,
      logs: isOwner ? player.logs : [],
      gossipVote: isOwner ? player.gossipVote : undefined,
      hasGossipVoted: !!player.gossipVote,
      votedFor: (isOwner || room.phase === GamePhase.RESULT || room.phase === GamePhase.GAME_OVER) ? player.votedFor : undefined,
      hasLockedVote: player.hasLockedVote,
    };
  });
  return { ...room, players: scrubbedPlayers };
}

async function emitState(room: GameState) {
  await saveRoom(room);
}

function refreshGossipQuestions(room: GameState) {
  room.gossipQuestions = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
}

async function processGossipQuestion(room: GameState) {
  const votes: Record<string, number> = {};
  room.players.forEach(p => { if (p.gossipVote) votes[p.gossipVote] = (votes[p.gossipVote] || 0) + 1; });
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const winnerId = sorted.length > 0 ? sorted[0][0] : null;
  const winnerName = winnerId ? room.players.find(p => p.id === winnerId)?.nickname || "Nadie" : "Nadie";
  room.gossipResults.push({ question: room.currentQuestion!, mostVotedId: winnerId, mostVotedName: winnerName });

  if (room.phase === GamePhase.GOSSIP_2) {
    await nextGossipStep(room);
    return;
  }

  room.phase = GamePhase.GOSSIP;
  room.isSecretActionWindow = true;
  room.timer = 20;
  room.players.forEach(p => p.isReadyToSkip = false);

  if (room.roundCount === 1) {
    const alivePlayers = room.players.filter(p => p.isAlive);
    const groupSize = Math.ceil(alivePlayers.length / 3);
    const startIndex = room.questionIndex * groupSize;
    const group = alivePlayers.slice(startIndex, startIndex + groupSize);
    group.forEach(p => {
      p.canPerformSecretAction = true;
      const possible = [SecretActionType.SNOOP, SecretActionType.STEAL, SecretActionType.SWAP, SecretActionType.SHUFFLE];
      if (p.role === Role.INNOCENT) possible.push(SecretActionType.ALIBI);
      p.assignedSecretAction = possible[Math.floor(Math.random() * possible.length)];
    });
    room.players.filter(p => p.isAlive && p.role === Role.KILLER).forEach(k => {
      if (!k.usedPlantEvidence) {
        k.canPerformSecretAction = true;
        k.assignedSecretAction = SecretActionType.PLANT_EVIDENCE;
      }
    });
  }

  await emitState(room);
}

async function nextGossipStep(room: GameState) {
  room.isSecretActionWindow = false;
  room.players.forEach(p => { p.canPerformSecretAction = false; p.assignedSecretAction = undefined; });
  room.questionIndex++;
  if (room.questionIndex < 3) {
    await startPhase(room, room.phase as GamePhase, GOSSIP_TIMER);
  } else {
    room.gossipResults = room.gossipResults.filter(r => r.mostVotedId);
    if (room.gossipResults.length === 0) {
      await startPhase(room, GamePhase.VOTING, VOTING_TIMER);
    } else {
      room.interrogationIndex = 0;
      await startPhase(room, GamePhase.INTERROGATION_INTRO, INTERROGATION_INTRO_TIMER);
    }
  }
}

async function startPhase(room: GameState, phase: GamePhase, duration: number) {
  room.phase = phase;
  room.timer = duration;
  room.eventMessage = undefined;

  if (phase === GamePhase.GOSSIP || phase === GamePhase.GOSSIP_2) {
    room.players.forEach(p => {
      p.gossipVote = undefined;
      p.canPerformSecretAction = false;
      p.assignedSecretAction = undefined;
      p.isReadyToSkip = false;
      p.notification = null;
    });
    room.isSecretActionWindow = false;
    if (room.gossipQuestions && room.gossipQuestions[room.questionIndex]) {
      room.currentQuestion = room.gossipQuestions[room.questionIndex];
    } else {
      const pool = phase === GamePhase.GOSSIP_2 ? GOSSIP_2_QUESTIONS : QUESTIONS;
      room.currentQuestion = pool[Math.floor(Math.random() * pool.length)];
    }
    if (phase === GamePhase.GOSSIP && room.questionIndex > 0 && !room.hasTriggeredRandomEvent && Math.random() < 0.15) {
      triggerRandomEvent(room);
      room.hasTriggeredRandomEvent = true;
    }
  }

  if (phase === GamePhase.INTERROGATION) {
    room.players.forEach(p => { p.isReadyToSkip = false; p.notification = null; });
    room.interrogationQuestion = INTERROGATION_QUESTIONS[Math.floor(Math.random() * INTERROGATION_QUESTIONS.length)];
    room.isInterrogationQuestionWindow = true;
    room.timer = 7;
  }

  if (phase === GamePhase.VOTING) {
    room.players.forEach(p => { p.votedFor = undefined; p.hasLockedVote = false; });
  }

  if (phase === GamePhase.RESULT) {
    handleVotingResults(room);
  }

  await emitState(room);
}

function executeBotAction(room: GameState, bot: Player) {
  const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
  if (others.length === 0) { bot.canPerformSecretAction = false; bot.assignedSecretAction = undefined; return; }
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  const swapItems = (a: Player, b: Player) => {
    const tmp = a.item; a.item = b.item; b.item = tmp;
    [a, b].forEach(p => {
      if (!p.id.startsWith('bot_')) {
        const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${p.item}`;
        if (!p.logs) p.logs = [];
        p.logs.push(msg);
        p.notification = { message: msg, type: 'swapped' };
      }
    });
  };

  switch (bot.assignedSecretAction) {
    case SecretActionType.STEAL: {
      const t = pick(others); const old = bot.item; bot.item = t.item; t.item = old;
      if (!t.id.startsWith('bot_')) {
        const msg = `¡Tu objeto fue robado! Ahora tienes: ${t.item}`;
        if (!t.logs) t.logs = []; t.logs.push(msg);
        t.notification = { message: msg, type: 'stolen' };
      }
      break;
    }
    case SecretActionType.SWAP: swapItems(bot, pick(others)); break;
    case SecretActionType.SHUFFLE: {
      if (others.length >= 2) { const t1 = pick(others); const t2 = pick(others.filter(o => o.id !== t1.id)); swapItems(t1, t2); }
      break;
    }
    case SecretActionType.PLANT_EVIDENCE: {
      if (!bot.usedPlantEvidence && bot.hasKnife) {
        const innocents = others.filter(o => o.role !== Role.KILLER);
        const t = innocents.length > 0 ? pick(innocents) : pick(others);
        t.isIncriminated = true; t.item = Item.KNIFE; bot.usedPlantEvidence = true;
        if (!t.id.startsWith('bot_')) {
          if (!t.logs) t.logs = [];
          t.logs.push("¡Alguien plantó pruebas contra ti!");
          t.notification = { message: "¡Alguien plantó pruebas contra ti!", type: 'incriminated' };
        }
      }
      break;
    }
    default: break;
  }
  bot.canPerformSecretAction = false; bot.assignedSecretAction = undefined;
}

function triggerRandomEvent(room: GameState) {
  const event = Math.random() < 0.5 ? "lights" : "witness";
  let message = "";
  if (event === "lights") {
    message = "¡Se apagaron las luces! Los objetos fueron intercambiados entre algunos inocentes.";
    const innocents = room.players.filter(p => p.isAlive && p.role === Role.INNOCENT);
    if (innocents.length > 1) {
      const items = innocents.map(p => p.item!);
      for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
      innocents.forEach((p, i) => {
        p.item = items[i];
        if (!p.logs) p.logs = [];
        const msg = `¡Las luces se apagaron! Tu nuevo objeto es: ${p.item}`;
        p.logs.push(msg);
        if (!p.id.startsWith('bot_')) p.notification = { message: msg, type: 'swapped' };
      });
    }
  } else {
    const innocents = room.players.filter(p => p.role === Role.INNOCENT);
    if (innocents.length > 0) {
      const v = innocents[Math.floor(Math.random() * innocents.length)];
      message = `Testigo: Se ha visto que ${v.nickname} tiene el objeto ${v.item}`;
      room.players.forEach(p => { if (!p.logs) p.logs = []; p.logs.push(message); });
    }
  }
  room.activePopup = { message, type: "event" };
  setTimeout(async () => {
    const r = await getRoom(room.roomId);
    if (r && r.activePopup?.message === message) { r.activePopup = null; await emitState(r); }
  }, 5000);
}

function handleVotingResults(room: GameState) {
  const votes: Record<string, number> = {};
  room.players.forEach(p => { if (p.votedFor) votes[p.votedFor] = (votes[p.votedFor] || 0) + 1; });
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) {
    const elim = room.players.find(p => p.id === sorted[0][0]);
    if (elim) {
      elim.isAlive = false;
      room.eventMessage = elim.role === Role.INNOCENT ? "Un inocente fue detenido injustamente" : "Un Asesino fue capturado";
    }
  }
  const aliveKillers = room.players.filter(p => p.isAlive && p.role === Role.KILLER);
  const aliveInnocents = room.players.filter(p => p.isAlive && p.role === Role.INNOCENT);
  if (aliveKillers.length === 0) { room.winner = Role.INNOCENT; room.phase = GamePhase.GAME_OVER; }
  else if (aliveKillers.length >= aliveInnocents.length) { room.winner = Role.KILLER; room.phase = GamePhase.GAME_OVER; }
}

setInterval(async () => {
  try {
    const allRooms = await getAllRooms();
    for (const room of allRooms) {
      if (room.phase === GamePhase.LOBBY || room.phase === GamePhase.GAME_OVER) continue;

      if (room.phase === GamePhase.GOSSIP || room.phase === GamePhase.GOSSIP_2) {
        if (room.isSecretActionWindow) {
          room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && p.canPerformSecretAction).forEach(bot => {
            if (Math.random() < 0.1) executeBotAction(room, bot);
          });
          if (room.timer <= 0) { await nextGossipStep(room); continue; }
        } else {
          room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote).forEach(bot => {
            if (Math.random() < 0.3) {
              const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
              if (others.length) bot.gossipVote = others[Math.floor(Math.random() * others.length)].id;
            }
          });
        }
      }

      if (room.phase === GamePhase.VOTING) {
        room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.hasLockedVote).forEach(bot => {
          if (Math.random() < 0.2) {
            const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
            if (others.length) { bot.votedFor = others[Math.floor(Math.random() * others.length)].id; bot.hasLockedVote = true; }
            if (room.players.filter(p => p.isAlive).every(p => p.hasLockedVote)) room.timer = 0;
          }
        });
      }

      if (room.timer > 0) room.timer--;

      if (room.timer <= 0) {
        switch (room.phase) {
          case GamePhase.REVEAL: await startPhase(room, GamePhase.INTRO, INTRO_TIMER); break;
          case GamePhase.INTRO: await startPhase(room, GamePhase.TRANSITION, 8); break;
          case GamePhase.TRANSITION: await startPhase(room, GamePhase.GOSSIP, GOSSIP_TIMER); break;
          case GamePhase.GOSSIP:
          case GamePhase.GOSSIP_2:
            if (room.isSecretActionWindow) await nextGossipStep(room);
            else await processGossipQuestion(room);
            break;
          case GamePhase.INTERROGATION_INTRO: await startPhase(room, GamePhase.INTERROGATION, 7); break;
          case GamePhase.INTERROGATION:
            if (room.isInterrogationQuestionWindow) {
              room.isInterrogationQuestionWindow = false; room.timer = 6; await emitState(room);
            } else {
              room.interrogationIndex++;
              if (room.interrogationIndex < room.gossipResults.length) await startPhase(room, GamePhase.INTERROGATION, 7);
              else await startPhase(room, GamePhase.VOTING, VOTING_TIMER);
            }
            break;
          case GamePhase.VOTING: await startPhase(room, GamePhase.RESULT, RESULT_TIMER); break;
          case GamePhase.RESULT:
            if ((room.phase as any) !== GamePhase.GAME_OVER && room.players.some(p => p.isAlive && p.role === Role.KILLER)) {
              room.roundCount++; room.questionIndex = 0; room.interrogationIndex = 0; room.gossipResults = [];
              const pool = [...GOSSIP_2_QUESTIONS]; const sel: string[] = [];
              for (let i = 0; i < 3 && pool.length; i++) sel.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
              room.gossipQuestions = sel;
              await startPhase(room, GamePhase.GOSSIP_2, GOSSIP_TIMER);
            }
            break;
        }
        continue;
      }

      await emitState(room);
    }
  } catch (err) { console.error("Game loop error:", err); }
}, 1000);

async function startServer() {
  const app = express();
  app.use(express.json());

  const getPlayerId = (req: express.Request): string => {
    return (req.headers['x-player-id'] as string) || '';
  };

  app.post('/api/create_room', async (req, res) => {
    const playerId = getPlayerId(req);
    const { nickname, avatar } = req.body;
    if (!nickname || !avatar || !playerId) { res.status(400).json({ error: 'Missing fields' }); return; }

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const host: Player = {
      id: playerId, nickname, avatar, isHost: true, isAlive: true,
      canPerformSecretAction: false, isIncriminated: false, roleRevealed: false, itemVisible: false, logs: []
    };
    const state: GameState = {
      roomId, phase: GamePhase.LOBBY, players: [host],
      timer: 0, roundCount: 1, questionIndex: 0, gossipResults: [], interrogationIndex: 0
    };
    await saveRoom(state);
    res.json(scrubStateFor(state, playerId));
  });

  app.post('/api/join_room', async (req, res) => {
    const playerId = getPlayerId(req);
    const { roomId, nickname, avatar } = req.body;
    const room = await getRoom(roomId?.toUpperCase());
    if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
    if (room.players.length >= 8) { res.status(400).json({ error: 'Room is full' }); return; }

    const existing = room.players.find(p => p.id === playerId);
    if (!existing) {
      room.players.push({
        id: playerId, nickname, avatar, isHost: false, isAlive: true,
        canPerformSecretAction: false, isIncriminated: false, roleRevealed: false, itemVisible: false, logs: []
      });
      await saveRoom(room);
    }
    res.json(scrubStateFor(room, playerId));
  });

  app.get('/api/state/:roomId', async (req, res) => {
    const playerId = getPlayerId(req);
    const room = await getRoom(req.params.roomId.toUpperCase());
    if (!room) { res.status(404).json({ error: 'Not found' }); return; }
    const msgs = flushMessages(playerId);
    res.json({ state: scrubStateFor(room, playerId), messages: msgs });
  });

  app.post('/api/action', async (req, res) => {
    const playerId = getPlayerId(req);
    const { roomId, type, payload } = req.body;
    const room = await getRoom(roomId?.toUpperCase());
    if (!room) { res.status(404).json({ error: 'Room not found' }); return; }

    const me = room.players.find(p => p.id === playerId);

    switch (type) {
      case 'add_bot': {
        if (!me?.isHost || room.phase !== GamePhase.LOBBY || room.players.length >= 8) break;
        const usedAvatars = room.players.map(p => p.avatar);
        const avail = AVATARS.filter(a => !usedAvatars.includes(a));
        if (!avail.length) break;
        const usedNames = room.players.map(p => p.nickname);
        const names = ["Benoit","Marta","Ransom","Linda","Richard","Joni","Walt","Jacob","Harlan","Meg","Fran","Alan"].filter(n => !usedNames.some(u => u.startsWith(n)));
        const botNick = names.length ? `${names[Math.floor(Math.random() * names.length)]} (Bot)` : `Invitado ${Math.floor(Math.random() * 999)} (Bot)`;
        room.players.push({
          id: `bot_${Math.random().toString(36).substring(2, 7)}`, nickname: botNick,
          avatar: avail[Math.floor(Math.random() * avail.length)], isHost: false, isAlive: true,
          canPerformSecretAction: false, isIncriminated: false, roleRevealed: true, itemVisible: false, logs: []
        });
        await saveRoom(room);
        break;
      }

      case 'reveal_role': {
        if (room.phase !== GamePhase.REVEAL || !me) break;
        me.roleRevealed = true; me.itemVisible = true;
        const allRevealed = room.players.filter(p => !p.id.startsWith('bot_')).every(p => p.roleRevealed);
        if (allRevealed && room.timer > 5) room.timer = 5;
        await saveRoom(room);
        break;
      }

      case 'start_game': {
        if (!me?.isHost || room.phase !== GamePhase.LOBBY) break;
        if (room.players.length < 4) { res.json({ ok: false, error: '¡Mínimo de 4 jugadores para comenzar!' }); return; }
        const count = room.players.length;
        const killerCount = count > 4 ? 2 : 1;
        const idx = Array.from({ length: count }, (_, i) => i).sort(() => Math.random() - 0.5);
        room.players.forEach((p, i) => {
          p.role = idx.slice(0, killerCount).includes(i) ? Role.KILLER : Role.INNOCENT;
          p.item = ITEMS_POOL[Math.floor(Math.random() * ITEMS_POOL.length)];
          p.hasKnife = p.role === Role.KILLER;
          p.isAlive = true; p.isIncriminated = false; p.roleRevealed = false;
          p.itemVisible = false; p.usedPlantEvidence = false; p.logs = [];
        });
        const killers = room.players.filter(p => p.role === Role.KILLER);
        if (killers.length > 1) {
          killers.forEach(k => {
            const msg = `Tu cómplice asesino es: ${killers.filter(o => o.id !== k.id).map(o => o.nickname).join(', ')}. ¡Trabajad juntos!`;
            k.logs.push(msg); k.notification = { message: msg, type: 'incriminated' };
          });
        }
        room.questionIndex = 0; room.roundCount = 1; room.interrogationIndex = 0;
        room.hasTriggeredRandomEvent = false; room.gossipResults = [];
        refreshGossipQuestions(room);
        await startPhase(room, GamePhase.REVEAL, REVEAL_TIMER);
        break;
      }

      case 'gossip_vote': {
        if ((room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2) || !me?.isAlive) break;
        const targetId = payload?.targetId;
        if (!targetId || targetId === playerId) break;
        me.gossipVote = targetId;
        const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
        bots.forEach(b => { if (!b.gossipVote) { const o = room.players.filter(x => x.id !== b.id && x.isAlive); b.gossipVote = o[Math.floor(Math.random() * o.length)].id; } });
        const allVoted = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive).every(p => p.gossipVote);
        if (allVoted && !room.isSecretActionWindow) { await processGossipQuestion(room); }
        else await saveRoom(room);
        break;
      }

      case 'secret_action': {
        if (room.phase !== GamePhase.GOSSIP || !me?.canPerformSecretAction) break;
        const p = payload as SecretActionPayload;
        const t1 = room.players.find(x => x.id === p.targetId1);
        const t2 = room.players.find(x => x.id === p.targetId2);

        const swapItems = (a: Player, b: Player) => {
          const tmp = a.item; a.item = b.item; b.item = tmp;
          [a, b].forEach(pl => {
            if (!pl.id.startsWith('bot_')) {
              const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${pl.item}`;
              if (!pl.logs) pl.logs = []; pl.logs.push(msg);
              pl.notification = { message: msg, type: 'swapped' };
              pushMessage(pl.id, 'event_message', msg);
            }
          });
        };

        switch (p.type) {
          case SecretActionType.SNOOP: {
            if (!t1) break;
            const item = (t1.hasKnife || t1.item === Item.KNIFE) ? Item.KNIFE : t1.item;
            const msg = `Husmeando: ${t1.nickname} tiene el objeto ${item}`;
            if (!me.logs) me.logs = []; me.logs.push(msg);
            pushMessage(playerId, 'event_message', msg);
            pushMessage(playerId, 'snoop_result', { targetId: t1.id, item });
            break;
          }
          case SecretActionType.STEAL: {
            if (!t1) break;
            const old = me.item; me.item = t1.item; t1.item = old;
            const msg = `¡Robaste el objeto de ${t1.nickname}! Ahora tienes: ${me.item}`;
            if (!me.logs) me.logs = []; me.logs.push(msg);
            pushMessage(playerId, 'event_message', msg);
            if (!t1.id.startsWith('bot_')) {
              const stolen = `¡Tu objeto fue robado! Ahora tienes: ${t1.item}`;
              if (!t1.logs) t1.logs = []; t1.logs.push(stolen);
              t1.notification = { message: stolen, type: 'stolen' };
              pushMessage(t1.id, 'event_message', stolen);
            }
            break;
          }
          case SecretActionType.SWAP: if (t1) { swapItems(me, t1); if (!me.logs) me.logs = []; me.logs.push(`Intercambiaste tu objeto con ${t1.nickname}`); } break;
          case SecretActionType.SHUFFLE: if (t1 && t2) { swapItems(t1, t2); if (!me.logs) me.logs = []; me.logs.push(`Mezclaste los objetos de ${t1.nickname} y ${t2.nickname}`); } break;
          case SecretActionType.ALIBI: {
            if (!t1) break;
            const a = `Coartada confirmada con ${t1.nickname}. Estáis a salvo.`;
            const b = `${me.nickname} confirmó una coartada contigo. Estáis a salvo.`;
            if (!me.logs) me.logs = []; me.logs.push(a); me.notification = { message: a, type: 'swapped' };
            pushMessage(playerId, 'event_message', a);
            if (!t1.id.startsWith('bot_')) { if (!t1.logs) t1.logs = []; t1.logs.push(b); t1.notification = { message: b, type: 'swapped' }; pushMessage(t1.id, 'event_message', b); }
            break;
          }
          case SecretActionType.PLANT_EVIDENCE: {
            if (!t1 || !me.hasKnife || me.usedPlantEvidence) break;
            t1.isIncriminated = true; t1.item = Item.KNIFE; me.usedPlantEvidence = true;
            const msg = `¡Incriminaste a ${t1.nickname}!`;
            if (!me.logs) me.logs = []; me.logs.push(msg); pushMessage(playerId, 'event_message', msg);
            if (!t1.id.startsWith('bot_')) {
              const inc = "¡HAS SIDO INCRIMINADO!";
              if (!t1.logs) t1.logs = []; t1.logs.push("¡Alguien plantó pruebas contra ti!");
              t1.notification = { message: "¡Alguien plantó pruebas contra ti!", type: 'incriminated' };
              pushMessage(t1.id, 'event_message', inc);
            }
            break;
          }
          case SecretActionType.SKIP: {
            if (me.assignedSecretAction !== SecretActionType.PLANT_EVIDENCE) break;
            if (!me.logs) me.logs = []; me.logs.push('Decidiste no actuar en este momento.');
            break;
          }
        }
        me.canPerformSecretAction = false;
        room.lastAction = { type: p.type, actor: me.nickname, details: '' };
        await saveRoom(room);
        break;
      }

      case 'skip_interrogation': {
        if (!me?.isAlive) break;
        if (room.phase === GamePhase.INTERROGATION) {
          if (room.isInterrogationQuestionWindow) break;
          if (playerId === room.gossipResults[room.interrogationIndex]?.mostVotedId) { room.timer = 0; await saveRoom(room); }
          break;
        }
        me.isReadyToSkip = true;
        const alive = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        if (alive.every(p => p.isReadyToSkip)) {
          if (room.isSecretActionWindow) await nextGossipStep(room);
          else { room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote).forEach(b => { const o = room.players.filter(x => x.id !== b.id && x.isAlive); if (o.length) b.gossipVote = o[Math.floor(Math.random() * o.length)].id; }); await processGossipQuestion(room); }
        } else await saveRoom(room);
        break;
      }

      case 'skip_gossip': {
        if (!me?.isAlive || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) break;
        me.isReadyToSkip = true;
        const alive = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        if (alive.every(p => p.isReadyToSkip)) {
          if (room.isSecretActionWindow) await nextGossipStep(room);
          else { room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote).forEach(b => { const o = room.players.filter(x => x.id !== b.id && x.isAlive); if (o.length) b.gossipVote = o[Math.floor(Math.random() * o.length)].id; }); await processGossipQuestion(room); }
        } else await saveRoom(room);
        break;
      }

      case 'toggle_item_exposure': {
        if (!me) break;
        me.itemExposed = !me.itemExposed;
        await saveRoom(room);
        break;
      }

      case 'clear_notification': {
        if (!me) break;
        me.notification = null;
        await saveRoom(room);
        break;
      }

      case 'vote': {
        if (room.phase !== GamePhase.VOTING || !me?.isAlive || me.hasLockedVote) break;
        const targetId = payload?.targetId;
        if (targetId && targetId !== playerId) { me.votedFor = targetId; await saveRoom(room); }
        break;
      }

      case 'lock_vote': {
        if (room.phase !== GamePhase.VOTING || !me?.isAlive || me.hasLockedVote) break;
        const targetId = payload?.targetId;
        if (!targetId || targetId === playerId) break;
        const target = room.players.find(p => p.id === targetId);
        if (!target?.isAlive) break;
        me.votedFor = targetId; me.hasLockedVote = true;
        room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.hasLockedVote).forEach(b => {
          const o = room.players.filter(x => x.id !== b.id && x.isAlive);
          if (o.length) { b.votedFor = o[Math.floor(Math.random() * o.length)].id; b.hasLockedVote = true; }
        });
        if (room.players.filter(p => p.isAlive).every(p => p.hasLockedVote)) room.timer = 0;
        await saveRoom(room);
        break;
      }

      case 'leave': {
        room.players = room.players.filter(p => p.id !== playerId);
        if (room.players.length === 0) { await deleteRoom(room.roomId); res.json({ ok: true }); return; }
        if (!room.players.some(p => p.isHost)) {
          const newHost = room.players.find(p => !p.id.startsWith('bot_'));
          if (newHost) newHost.isHost = true; else { await deleteRoom(room.roomId); res.json({ ok: true }); return; }
        }
        await saveRoom(room);
        break;
      }
    }

    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  createServer(app).listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
