import { GamePhase, Role, Item, Player, GameState, SecretActionType } from "../src/types.js";
import { saveRoom, deleteRoom, getRoom } from "./_db.js";

export const GOSSIP_TIMER = 300;
export const REVEAL_TIMER = 10;
export const INTRO_TIMER = 28;
export const INTERROGATION_INTRO_TIMER = 20;
export const VOTING_TIMER = 60;
export const RESULT_TIMER = 15;

export const AVATARS = ['bibs', 'gb', 'lavis', 'lucas', 'mat', 'mel', '🤵', '💃'];
export const ITEMS_POOL = Object.values(Item).filter(i => i !== Item.KNIFE);

const QUESTIONS = [
  "¿Quién es el más probable de ser el asesino?",
  "¿Quién tiene la sonrisa más sospechosa?",
  "¿Quién es el más hablador?",
  "¿Quién está más callado?",
  "¿Quién está más agitado?",
];
const GOSSIP_2_QUESTIONS = [
  "¿Quién defendió más a un sospechoso?",
  "¿Quién discutió más durante la votación?",
  "¿Quién fue el más callado?",
  "¿Quién está actuando de forma sospechosa?",
];
const INTERROGATION_QUESTIONS = [
  "Cuéntanos lo que sabes",
  "¿Intercambiaste algún objeto?",
  "¿Robaste algún objeto?",
  "¿Incriminaste a alguien?",
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function refreshGossipQuestions(room: GameState) {
  room.gossipQuestions = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 3);
}

export function handleVotingResults(room: GameState) {
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

export async function startPhase(room: GameState, phase: GamePhase, duration: number) {
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
    if (room.gossipQuestions?.[room.questionIndex]) {
      room.currentQuestion = room.gossipQuestions[room.questionIndex];
    } else {
      room.currentQuestion = pick(phase === GamePhase.GOSSIP_2 ? GOSSIP_2_QUESTIONS : QUESTIONS);
    }
    if (phase === GamePhase.GOSSIP && room.questionIndex > 0 && !room.hasTriggeredRandomEvent && Math.random() < 0.15) {
      triggerRandomEvent(room);
      room.hasTriggeredRandomEvent = true;
    }
  }

  if (phase === GamePhase.INTERROGATION) {
    room.players.forEach(p => { p.isReadyToSkip = false; p.notification = null; });
    room.interrogationQuestion = pick(INTERROGATION_QUESTIONS);
    room.isInterrogationQuestionWindow = true;
    room.timer = 7;
  }

  if (phase === GamePhase.VOTING) {
    room.players.forEach(p => { p.votedFor = undefined; p.hasLockedVote = false; });
  }

  if (phase === GamePhase.RESULT) handleVotingResults(room);

  await saveRoom(room);
}

export async function processGossipQuestion(room: GameState) {
  const votes: Record<string, number> = {};
  room.players.forEach(p => { if (p.gossipVote) votes[p.gossipVote] = (votes[p.gossipVote] || 0) + 1; });
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const winnerId = sorted[0]?.[0] ?? null;
  const winnerName = winnerId ? room.players.find(p => p.id === winnerId)?.nickname ?? "Nadie" : "Nadie";
  room.gossipResults.push({ question: room.currentQuestion!, mostVotedId: winnerId, mostVotedName: winnerName });

  if (room.phase === GamePhase.GOSSIP_2) { await nextGossipStep(room); return; }

  room.isSecretActionWindow = true;
  room.timer = 20;
  room.players.forEach(p => p.isReadyToSkip = false);

  if (room.roundCount === 1) {
    const alive = room.players.filter(p => p.isAlive);
    const groupSize = Math.ceil(alive.length / 3);
    alive.slice(room.questionIndex * groupSize, (room.questionIndex + 1) * groupSize).forEach(p => {
      p.canPerformSecretAction = true;
      const possible = [SecretActionType.SNOOP, SecretActionType.STEAL, SecretActionType.SWAP, SecretActionType.SHUFFLE];
      if (p.role === Role.INNOCENT) possible.push(SecretActionType.ALIBI);
      p.assignedSecretAction = pick(possible);
    });
    room.players.filter(p => p.isAlive && p.role === Role.KILLER && !p.usedPlantEvidence).forEach(k => {
      k.canPerformSecretAction = true;
      k.assignedSecretAction = SecretActionType.PLANT_EVIDENCE;
    });
  }

  await saveRoom(room);
}

export async function nextGossipStep(room: GameState) {
  room.isSecretActionWindow = false;
  room.players.forEach(p => { p.canPerformSecretAction = false; p.assignedSecretAction = undefined; });
  room.questionIndex++;
  if (room.questionIndex < 3) {
    await startPhase(room, room.phase as GamePhase, GOSSIP_TIMER);
  } else {
    room.gossipResults = room.gossipResults.filter(r => r.mostVotedId);
    if (room.gossipResults.length === 0) await startPhase(room, GamePhase.VOTING, VOTING_TIMER);
    else { room.interrogationIndex = 0; await startPhase(room, GamePhase.INTERROGATION_INTRO, INTERROGATION_INTRO_TIMER); }
  }
}

export function executeBotAction(room: GameState, bot: Player) {
  const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
  if (!others.length) { bot.canPerformSecretAction = false; bot.assignedSecretAction = undefined; return; }

  const swapItems = (a: Player, b: Player) => {
    const tmp = a.item; a.item = b.item; b.item = tmp;
    [a, b].forEach(p => {
      if (!p.id.startsWith('bot_')) {
        const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${p.item}`;
        if (!p.logs) p.logs = []; p.logs.push(msg);
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
      if (others.length >= 2) { const t1 = pick(others); swapItems(t1, pick(others.filter(o => o.id !== t1.id))); }
      break;
    }
    case SecretActionType.PLANT_EVIDENCE: {
      if (!bot.usedPlantEvidence && bot.hasKnife) {
        const t = pick(others.filter(o => o.role !== Role.KILLER).length ? others.filter(o => o.role !== Role.KILLER) : others);
        t.isIncriminated = true; t.item = Item.KNIFE; bot.usedPlantEvidence = true;
        if (!t.id.startsWith('bot_')) {
          if (!t.logs) t.logs = []; t.logs.push("¡Alguien plantó pruebas contra ti!");
          t.notification = { message: "¡Alguien plantó pruebas contra ti!", type: 'incriminated' };
        }
      }
      break;
    }
  }
  bot.canPerformSecretAction = false; bot.assignedSecretAction = undefined;
}

function triggerRandomEvent(room: GameState) {
  const isLights = Math.random() < 0.5;
  let message = "";
  if (isLights) {
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
      const v = pick(innocents);
      message = `Testigo: Se ha visto que ${v.nickname} tiene el objeto ${v.item}`;
      room.players.forEach(p => { if (!p.logs) p.logs = []; p.logs.push(message); });
    }
  }
  room.activePopup = { message, type: "event" };
}

export async function runTick(room: GameState): Promise<GameState> {
  if (room.phase === GamePhase.LOBBY || room.phase === GamePhase.GAME_OVER) return room;

  if (room.phase === GamePhase.GOSSIP || room.phase === GamePhase.GOSSIP_2) {
    if (room.isSecretActionWindow) {
      room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && p.canPerformSecretAction).forEach(bot => {
        if (Math.random() < 0.1) executeBotAction(room, bot);
      });
    } else {
      room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote).forEach(bot => {
        if (Math.random() < 0.3) {
          const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
          if (others.length) bot.gossipVote = pick(others).id;
        }
      });
    }
  }

  if (room.phase === GamePhase.VOTING) {
    room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.hasLockedVote).forEach(bot => {
      if (Math.random() < 0.2) {
        const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
        if (others.length) { bot.votedFor = pick(others).id; bot.hasLockedVote = true; }
      }
    });
    if (room.players.filter(p => p.isAlive).every(p => p.hasLockedVote)) room.timer = 0;
  }

  if (room.timer > 0) { room.timer--; await saveRoom(room); return room; }

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
        room.isInterrogationQuestionWindow = false; room.timer = 6; await saveRoom(room);
      } else {
        room.interrogationIndex++;
        if (room.interrogationIndex < room.gossipResults.length) await startPhase(room, GamePhase.INTERROGATION, 7);
        else await startPhase(room, GamePhase.VOTING, VOTING_TIMER);
      }
      break;
    case GamePhase.VOTING: await startPhase(room, GamePhase.RESULT, RESULT_TIMER); break;
    case GamePhase.RESULT:
      if (room.players.some(p => p.isAlive && p.role === Role.KILLER)) {
        room.roundCount++; room.questionIndex = 0; room.interrogationIndex = 0; room.gossipResults = [];
        const pool = [...GOSSIP_2_QUESTIONS]; const sel: string[] = [];
        for (let i = 0; i < 3 && pool.length; i++) sel.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        room.gossipQuestions = sel;
        await startPhase(room, GamePhase.GOSSIP_2, GOSSIP_TIMER);
      }
      break;
  }

  return room;
}
