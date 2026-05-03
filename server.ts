import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
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
const GOSSIP_VOTING_TIMER = 30;
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

async function savePlayerSocket(socketId: string, roomId: string) {
  await setDoc(doc(db, "playerSockets", socketId), { roomId });
}

async function getPlayerSocket(socketId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "playerSockets", socketId));
  return snap.exists() ? snap.data().roomId : null;
}

async function deletePlayerSocket(socketId: string) {
  await deleteDoc(doc(db, "playerSockets", socketId));
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    transports: ["polling"],
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    socket.on("create_room", async ({ nickname, avatar }) => {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const host: Player = {
        id: socket.id,
        nickname,
        avatar,
        isHost: true,
        isAlive: true,
        canPerformSecretAction: false,
        isIncriminated: false,
        roleRevealed: false,
        itemVisible: false,
        logs: []
      };

      const newState: GameState = {
        roomId,
        phase: GamePhase.LOBBY,
        players: [host],
        timer: 0,
        roundCount: 1,
        questionIndex: 0,
        gossipResults: [],
        interrogationIndex: 0
      };

      await saveRoom(newState);
      await savePlayerSocket(socket.id, roomId);
      socket.join(roomId);
      socket.emit("room_created", newState);
    });

    socket.on("join_room", async ({ roomId, nickname, avatar }) => {
      const normalizedRoomId = roomId.toUpperCase();
      const room = await getRoom(normalizedRoomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (room.players.length >= 8) {
        socket.emit("error", "Room is full");
        return;
      }

      const newPlayer: Player = {
        id: socket.id,
        nickname,
        avatar,
        isHost: false,
        isAlive: true,
        canPerformSecretAction: false,
        isIncriminated: false,
        roleRevealed: false,
        itemVisible: false,
        logs: []
      };

      room.players.push(newPlayer);
      await savePlayerSocket(socket.id, normalizedRoomId);
      socket.join(normalizedRoomId);
      await emitState(room);
    });

    socket.on("add_bot", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room) return;
      const requester = room.players.find(p => p.id === socket.id);
      if (!requester?.isHost) return;
      if (room.phase !== GamePhase.LOBBY) return;
      if (room.players.length >= 8) return;

      const usedAvatars = room.players.map(p => p.avatar);
      const availableAvatars = AVATARS.filter(a => !usedAvatars.includes(a));
      if (availableAvatars.length === 0) return;

      const botId = `bot_${Math.random().toString(36).substring(2, 7)}`;
      const usedNames = room.players.map(p => p.nickname);
      const possibleBotNames = ["Benoit", "Marta", "Ransom", "Linda", "Richard", "Joni", "Walt", "Jacob", "Harlan", "Meg", "Fran", "Alan"];
      const botNames = possibleBotNames.filter(n => !usedNames.some(un => un.startsWith(n)));

      let botNickname = "";
      if (botNames.length > 0) {
        botNickname = `${botNames[Math.floor(Math.random() * botNames.length)]} (Bot)`;
      } else {
        botNickname = `Invitado ${Math.floor(Math.random() * 999)} (Bot)`;
      }

      const bot: Player = {
        id: botId,
        nickname: botNickname,
        avatar: availableAvatars[Math.floor(Math.random() * availableAvatars.length)],
        isHost: false,
        isAlive: true,
        canPerformSecretAction: false,
        isIncriminated: false,
        roleRevealed: true,
        itemVisible: false,
        logs: []
      };

      room.players.push(bot);
      await emitState(room);
    });

    socket.on("reveal_role", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || room.phase !== GamePhase.REVEAL) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.roleRevealed = true;
        player.itemVisible = true;

        const allRevealed = room.players.filter(p => !p.id.startsWith('bot_')).every(p => p.roleRevealed);
        if (allRevealed && room.timer > 5) {
          room.timer = 5;
        }

        await emitState(room);
      }
    });

    socket.on("start_game", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room) return;
      const requester = room.players.find(p => p.id === socket.id);
      if (!requester?.isHost) return;
      if (room.phase !== GamePhase.LOBBY) return;
      if (room.players.length < 4) {
        socket.emit("event_message", "¡Mínimo de 4 jugadores para comenzar!");
        return;
      }

      const playerCount = room.players.length;
      const killerCount = playerCount > 4 ? 2 : 1;
      const shuffledIndices = Array.from({ length: playerCount }, (_, i) => i)
        .sort(() => Math.random() - 0.5);

      room.players.forEach((p, i) => {
        const isKiller = shuffledIndices.slice(0, killerCount).includes(i);
        p.role = isKiller ? Role.KILLER : Role.INNOCENT;
        p.item = ITEMS_POOL[Math.floor(Math.random() * ITEMS_POOL.length)];
        p.hasKnife = isKiller;
        p.isAlive = true;
        p.isIncriminated = false;
        p.roleRevealed = false;
        p.itemVisible = false;
        p.usedPlantEvidence = false;
        p.logs = [];
      });

      const killers = room.players.filter(p => p.role === Role.KILLER);
      if (killers.length > 1) {
        killers.forEach(k => {
          const others = killers.filter(other => other.id !== k.id);
          const partnerNames = others.map(o => o.nickname).join(", ");
          const msg = `Tu cómplice asesino es: ${partnerNames}. ¡Trabajad juntos para escapar de la mansión!`;
          k.logs.push(msg);
          k.notification = { message: msg, type: 'incriminated' };
        });
      }

      room.questionIndex = 0;
      room.roundCount = 1;
      room.interrogationIndex = 0;
      room.hasTriggeredRandomEvent = false;
      room.gossipResults = [];
      refreshGossipQuestions(room);
      await startPhase(room, GamePhase.REVEAL, REVEAL_TIMER);
    });

    socket.on("gossip_vote", async (targetId) => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
        if (player.id === targetId) return;

        player.gossipVote = targetId;
        await emitState(room);

        const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);

        bots.forEach(b => {
          if (!b.gossipVote) {
            const others = room.players.filter(o => o.id !== b.id && o.isAlive);
            b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
          }
        });

        const allRealPlayersVoted = alivePlayers.every(p => p.gossipVote);
        if (allRealPlayersVoted && !room.isSecretActionWindow) {
          await processGossipQuestion(room);
        }
      }
    });

    socket.on("secret_action", async (payload: SecretActionPayload) => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || room.phase !== GamePhase.GOSSIP) return;

      const actor = room.players.find(p => p.id === socket.id);
      if (!actor || !actor.canPerformSecretAction) return;

      const target1 = room.players.find(p => p.id === payload.targetId1);
      const target2 = room.players.find(p => p.id === payload.targetId2);

      if (!target1) return;

      let detail = "";
      const swapItems = (p1: Player, p2: Player) => {
        const temp = p1.item;
        p1.item = p2.item;
        p2.item = temp;

        if (!p1.id.startsWith('bot_')) {
          const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${p1.item}`;
          io.to(p1.id).emit("event_message", msg);
          if (!p1.logs) p1.logs = [];
          p1.logs.push(msg);
          p1.notification = { message: msg, type: 'swapped' };
        }
        if (!p2.id.startsWith('bot_')) {
          const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${p2.item}`;
          io.to(p2.id).emit("event_message", msg);
          if (!p2.logs) p2.logs = [];
          p2.logs.push(msg);
          p2.notification = { message: msg, type: 'swapped' };
        }
      };

      switch (payload.type) {
        case SecretActionType.SNOOP:
          const resultItem = (target1.hasKnife || target1.item === Item.KNIFE) ? Item.KNIFE : target1.item;
          const snoopMsg = `Husmeando: ${target1.nickname} tiene el objeto ${resultItem}`;
          socket.emit("event_message", snoopMsg);
          if (!actor.logs) actor.logs = [];
          actor.logs.push(snoopMsg);
          socket.emit("snoop_result", { targetId: target1.id, item: resultItem });
          detail = `snooped on ${target1.nickname}`;
          break;
        case SecretActionType.STEAL:
          const oldItem = actor.item;
          actor.item = target1.item;
          target1.item = oldItem;
          const stealMsg = `¡Robaste el objeto de ${target1.nickname}! Ahora tienes: ${actor.item}`;
          socket.emit("event_message", stealMsg);
          if (!actor.logs) actor.logs = [];
          actor.logs.push(stealMsg);
          if (!target1.id.startsWith('bot_')) {
            const stolenMsg = `¡Tu objeto fue robado! Ahora tienes: ${target1.item}`;
            io.to(target1.id).emit("event_message", stolenMsg);
            if (!target1.logs) target1.logs = [];
            target1.logs.push(stolenMsg);
            target1.notification = { message: stolenMsg, type: 'stolen' };
          }
          detail = `stole from ${target1.nickname}`;
          break;
        case SecretActionType.SWAP:
          swapItems(actor, target1);
          detail = `swapped with ${target1.nickname}`;
          if (!actor.logs) actor.logs = [];
          actor.logs.push(`Intercambiaste tu objeto con ${target1.nickname}`);
          break;
        case SecretActionType.SHUFFLE:
          if (target2) {
            swapItems(target1, target2);
            detail = `shuffled items of ${target1.nickname} and ${target2.nickname}`;
            if (!actor.logs) actor.logs = [];
            actor.logs.push(`Mezclaste los objetos de ${target1.nickname} y ${target2.nickname}`);
          }
          break;
        case SecretActionType.ALIBI: {
          const actorMsg = `Coartada confirmada con ${target1.nickname}. Estáis a salvo.`;
          const targetMsg = `${actor.nickname} confirmó una coartada contigo. Estáis a salvo.`;
          socket.emit("event_message", actorMsg);
          if (!actor.logs) actor.logs = [];
          actor.logs.push(actorMsg);
          actor.notification = { message: actorMsg, type: 'swapped' };
          if (!target1.id.startsWith('bot_')) {
            io.to(target1.id).emit("event_message", targetMsg);
            if (!target1.logs) target1.logs = [];
            target1.logs.push(targetMsg);
            target1.notification = { message: targetMsg, type: 'swapped' };
          }
          detail = `confirmed alibi with ${target1.nickname}`;
          break;
        }
        case SecretActionType.PLANT_EVIDENCE:
          if (!actor.usedPlantEvidence && actor.hasKnife) {
            target1.isIncriminated = true;
            target1.item = Item.KNIFE;
            actor.usedPlantEvidence = true;
            const plantMsg = `¡Incriminaste a ${target1.nickname}!`;
            socket.emit("event_message", plantMsg);
            if (!actor.logs) actor.logs = [];
            actor.logs.push(plantMsg);
            if (!target1.id.startsWith('bot_')) {
              io.to(target1.id).emit("event_message", "¡HAS SIDO INCRIMINADO!");
              if (!target1.logs) target1.logs = [];
              target1.logs.push("¡Alguien plantó pruebas contra ti!");
              target1.notification = { message: "¡Alguien plantó pruebas contra ti!", type: 'incriminated' };
            }
            detail = `planted evidence on ${target1.nickname}`;
          }
          break;
        case SecretActionType.SKIP:
          if (actor.assignedSecretAction !== SecretActionType.PLANT_EVIDENCE) return;
          detail = `chose not to act now`;
          if (!actor.logs) actor.logs = [];
          actor.logs.push(`Decidiste no actuar en este momento.`);
          break;
      }

      actor.canPerformSecretAction = false;
      room.lastAction = { type: payload.type, actor: actor.nickname, details: detail };
      await emitState(room);
    });

    socket.on("skip_interrogation", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || (room.phase !== GamePhase.INTERROGATION && room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
        if (room.phase === GamePhase.INTERROGATION) {
          if (room.isInterrogationQuestionWindow) return;
          const currentSuspectId = room.gossipResults[room.interrogationIndex]?.mostVotedId;
          if (socket.id === currentSuspectId) {
            room.timer = 0;
            await emitState(room);
          }
          return;
        }

        player.isReadyToSkip = true;
        await emitState(room);

        const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        if (alivePlayers.every(p => p.isReadyToSkip)) {
          if (room.isSecretActionWindow) {
            await nextGossipStep(room);
          } else {
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
            bots.forEach(b => {
              if (!b.gossipVote) {
                const others = room.players.filter(o => o.id !== b.id && o.isAlive);
                if (others.length > 0) {
                  b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                }
              }
            });
            await processGossipQuestion(room);
          }
        }
      }
    });

    socket.on("skip_gossip", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
        player.isReadyToSkip = true;
        await emitState(room);

        const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        const allReady = alivePlayers.every(p => p.isReadyToSkip);

        if (allReady) {
          if (room.isSecretActionWindow) {
            await nextGossipStep(room);
          } else {
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
            bots.forEach(b => {
              if (!b.gossipVote) {
                const others = room.players.filter(o => o.id !== b.id && o.isAlive);
                if (others.length > 0) {
                  b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                }
              }
            });
            await processGossipQuestion(room);
          }
        }
      }
    });

    socket.on("toggle_item_exposure", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.itemExposed = !player.itemExposed;
        await emitState(room);
      }
    });

    socket.on("clear_notification", async () => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.notification = null;
        await emitState(room);
      }
    });

    socket.on("vote", async (targetId) => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || room.phase !== GamePhase.VOTING) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive && !player.hasLockedVote) {
        if (player.id === targetId) return;
        player.votedFor = targetId;
        await emitState(room);
      }
    });

    socket.on("lock_vote", async (targetId) => {
      const roomId = await getPlayerSocket(socket.id);
      const room = await roomById(roomId);
      if (!room || room.phase !== GamePhase.VOTING) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive && !player.hasLockedVote) {
        if (player.id === targetId) return;
        const target = room.players.find(p => p.id === targetId);
        if (!target || !target.isAlive) return;
        player.votedFor = targetId;
        player.hasLockedVote = true;

        const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
        bots.forEach(b => {
          if (!b.votedFor) {
            const others = room.players.filter(o => o.id !== b.id && o.isAlive);
            if (others.length > 0) {
              b.votedFor = others[Math.floor(Math.random() * others.length)].id;
            }
            b.hasLockedVote = true;
          }
        });

        await emitState(room);

        const alivePlayersVisible = room.players.filter(p => p.isAlive);
        if (alivePlayersVisible.every(p => p.hasLockedVote)) {
          room.timer = 0;
          await saveRoom(room);
        }
      }
    });

    socket.on("disconnect", async () => {
      const roomId = await getPlayerSocket(socket.id);
      if (roomId) {
        const room = await getRoom(roomId);
        if (room) {
          room.players = room.players.filter(p => p.id !== socket.id);
          if (room.players.length === 0) {
            await deleteRoom(roomId);
          } else {
            const hadHost = room.players.some(p => p.isHost);
            if (!hadHost) {
              const newHost = room.players.find(p => !p.id.startsWith('bot_'));
              if (newHost) {
                newHost.isHost = true;
              } else {
                await deleteRoom(roomId);
                await deletePlayerSocket(socket.id);
                return;
              }
            }
            await emitState(room);
          }
        }
        await deletePlayerSocket(socket.id);
      }
    });
  });

  async function roomById(id?: string | null): Promise<GameState | null> {
    return id ? getRoom(id) : null;
  }

  function refreshGossipQuestions(room: GameState) {
    room.gossipQuestions = [...QUESTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
  }

  async function emitState(room: GameState, event: string = "state_updated") {
    await saveRoom(room);
    room.players.forEach(p => {
      if (!p.id.startsWith('bot_')) {
        const scrubbedPlayers = room.players.map(player => {
          const isOwner = player.id === p.id;
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
            hasLockedVote: player.hasLockedVote
          };
        });

        io.to(p.id).emit(event, {
          ...room,
          players: scrubbedPlayers
        });
      }
    });
  }

  async function processGossipQuestion(room: GameState) {
    const votes: Record<string, number> = {};
    room.players.forEach(p => {
      if (p.gossipVote) {
        votes[p.gossipVote] = (votes[p.gossipVote] || 0) + 1;
      }
    });

    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const winnerId = sorted.length > 0 ? sorted[0][0] : null;
    const winnerName = winnerId ? room.players.find(p => p.id === winnerId)?.nickname || "Nadie" : "Nadie";

    room.gossipResults.push({
      question: room.currentQuestion!,
      mostVotedId: winnerId,
      mostVotedName: winnerName
    });

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
      const startIndex = (room.questionIndex) * groupSize;
      const group = alivePlayers.slice(startIndex, startIndex + groupSize);

      group.forEach(p => {
        p.canPerformSecretAction = true;
        const possibleActions = [
          SecretActionType.SNOOP,
          SecretActionType.STEAL,
          SecretActionType.SWAP,
          SecretActionType.SHUFFLE
        ];
        if (p.role === Role.INNOCENT) possibleActions.push(SecretActionType.ALIBI);
        p.assignedSecretAction = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      });

      const allKillers = room.players.filter(p => p.isAlive && p.role === Role.KILLER);
      allKillers.forEach(k => {
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
    room.players.forEach(p => {
      p.canPerformSecretAction = false;
      p.assignedSecretAction = undefined;
    });

    room.questionIndex++;
    const currentMax = 3;

    if (room.questionIndex < currentMax) {
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
      room.players.forEach(p => {
        p.isReadyToSkip = false;
        p.notification = null;
      });
      room.interrogationQuestion = INTERROGATION_QUESTIONS[Math.floor(Math.random() * INTERROGATION_QUESTIONS.length)];
      room.isInterrogationQuestionWindow = true;
      room.timer = 7;
    }

    if (phase === GamePhase.VOTING) {
      room.players.forEach(p => {
        p.votedFor = undefined;
        p.hasLockedVote = false;
      });
    }

    if (phase === GamePhase.RESULT) {
      handleVotingResults(room);
    }

    await emitState(room, "phase_started");
  }

  function executeBotAction(room: GameState, bot: Player) {
    const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
    if (others.length === 0) {
      bot.canPerformSecretAction = false;
      bot.assignedSecretAction = undefined;
      return;
    }
    const pickRandom = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    const action = bot.assignedSecretAction;

    const swapItems = (a: Player, b: Player) => {
      const temp = a.item;
      a.item = b.item;
      b.item = temp;
      [a, b].forEach(p => {
        if (!p.id.startsWith('bot_')) {
          const msg = `¡Tu objeto fue intercambiado! Ahora tienes: ${p.item}`;
          io.to(p.id).emit("event_message", msg);
          if (!p.logs) p.logs = [];
          p.logs.push(msg);
          p.notification = { message: msg, type: 'swapped' };
        }
      });
    };

    switch (action) {
      case SecretActionType.SNOOP:
      case SecretActionType.ALIBI:
      case SecretActionType.SKIP:
        break;
      case SecretActionType.STEAL: {
        const target = pickRandom(others);
        const oldItem = bot.item;
        bot.item = target.item;
        target.item = oldItem;
        if (!target.id.startsWith('bot_')) {
          const stolenMsg = `¡Tu objeto fue robado! Ahora tienes: ${target.item}`;
          io.to(target.id).emit("event_message", stolenMsg);
          if (!target.logs) target.logs = [];
          target.logs.push(stolenMsg);
          target.notification = { message: stolenMsg, type: 'stolen' };
        }
        break;
      }
      case SecretActionType.SWAP: {
        const target = pickRandom(others);
        swapItems(bot, target);
        break;
      }
      case SecretActionType.SHUFFLE: {
        if (others.length >= 2) {
          const t1 = pickRandom(others);
          const remaining = others.filter(o => o.id !== t1.id);
          const t2 = pickRandom(remaining);
          swapItems(t1, t2);
        }
        break;
      }
      case SecretActionType.PLANT_EVIDENCE: {
        if (!bot.usedPlantEvidence && bot.hasKnife) {
          const innocentTargets = others.filter(o => o.role !== Role.KILLER);
          const target = innocentTargets.length > 0 ? pickRandom(innocentTargets) : pickRandom(others);
          target.isIncriminated = true;
          target.item = Item.KNIFE;
          bot.usedPlantEvidence = true;
          if (!target.id.startsWith('bot_')) {
            io.to(target.id).emit("event_message", "¡HAS SIDO INCRIMINADO!");
            if (!target.logs) target.logs = [];
            target.logs.push("¡Alguien plantó pruebas contra ti!");
            target.notification = { message: "¡Alguien plantó pruebas contra ti!", type: 'incriminated' };
          }
        }
        break;
      }
      default: {
        const target = pickRandom(others);
        swapItems(bot, target);
      }
    }

    bot.canPerformSecretAction = false;
    bot.assignedSecretAction = undefined;
  }

  function triggerRandomEvent(room: GameState) {
    const events = ["Se apagaron las luces", "Testigo"];
    const event = events[Math.floor(Math.random() * events.length)];

    let message = "";

    if (event === "Se apagaron las luces") {
      message = "¡Se apagaron las luces! Los objetos fueron intercambiados entre algunos inocentes.";
      const aliveInnocents = room.players.filter(p => p.isAlive && p.role === Role.INNOCENT);
      if (aliveInnocents.length > 1) {
        const items = aliveInnocents.map(p => p.item!);
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }
        aliveInnocents.forEach((p, i) => {
          p.item = items[i];
          if (!p.logs) p.logs = [];
          const logMsg = `¡Las luces se apagaron! Tu nuevo objeto es: ${p.item}`;
          p.logs.push(logMsg);
          if (!p.id.startsWith('bot_')) {
            p.notification = { message: logMsg, type: 'swapped' };
          }
        });
      }
    } else if (event === "Testigo") {
      const innocents = room.players.filter(p => p.role === Role.INNOCENT);
      if (innocents.length > 0) {
        const victim = innocents[Math.floor(Math.random() * innocents.length)];
        message = `Testigo: Se ha visto que ${victim.nickname} tiene el objeto ${victim.item}`;
        room.players.forEach(p => {
          if (!p.logs) p.logs = [];
          p.logs.push(message);
        });
      }
    }

    room.activePopup = { message, type: "event" };
    setTimeout(async () => {
      const currentRoom = await getRoom(room.roomId);
      if (currentRoom && currentRoom.activePopup?.message === message) {
        currentRoom.activePopup = null;
        await emitState(currentRoom);
      }
    }, 5000);
  }

  function handleVotingResults(room: GameState) {
    const votes: Record<string, number> = {};
    room.players.forEach(p => {
      if (p.votedFor) {
        votes[p.votedFor] = (votes[p.votedFor] || 0) + 1;
      }
    });

    const sortedVotes = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    let eliminated: Player | undefined;

    if (sortedVotes.length > 0 && (sortedVotes.length === 1 || sortedVotes[0][1] > sortedVotes[1][1])) {
      const eliminatedId = sortedVotes[0][0];
      eliminated = room.players.find(p => p.id === eliminatedId);
      if (eliminated) {
        eliminated.isAlive = false;
        if (eliminated.role === Role.INNOCENT) {
          room.eventMessage = "Un inocente fue detenido injustamente";
        } else {
          room.eventMessage = "Un Asesino fue capturado";
        }
      }
    }

    const aliveKillers = room.players.filter(p => p.isAlive && p.role === Role.KILLER);
    const aliveInnocents = room.players.filter(p => p.isAlive && p.role === Role.INNOCENT);

    if (aliveKillers.length === 0) {
      room.winner = Role.INNOCENT;
      room.phase = GamePhase.GAME_OVER;
    } else if (aliveKillers.length >= aliveInnocents.length) {
      room.winner = Role.KILLER;
      room.phase = GamePhase.GAME_OVER;
    }
  }

  setInterval(async () => {
    try {
      const allRooms = await getAllRooms();
      for (const room of allRooms) {
        if (room.phase === GamePhase.LOBBY || room.phase === GamePhase.GAME_OVER) continue;

        if (room.phase === GamePhase.GOSSIP || room.phase === GamePhase.GOSSIP_2) {
          if (room.isSecretActionWindow) {
            const aliveBotsWithActions = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && p.canPerformSecretAction);
            aliveBotsWithActions.forEach(bot => {
              if (Math.random() < 0.1) {
                executeBotAction(room, bot);
              }
            });

            if (room.timer <= 0) {
              await nextGossipStep(room);
              continue;
            }
          } else {
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote);
            bots.forEach(bot => {
              if (Math.random() < 0.3) {
                const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
                bot.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                const alivePlayers = room.players.filter(p => p.isAlive);
                if (alivePlayers.every(p => p.gossipVote) && !room.isSecretActionWindow) {
                  // will be handled below after timer decrement
                }
              }
            });
          }
        }

        if (room.phase === GamePhase.VOTING) {
          const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.hasLockedVote);
          bots.forEach(bot => {
            if (Math.random() < 0.2) {
              const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
              bot.votedFor = others[Math.floor(Math.random() * others.length)].id;
              bot.hasLockedVote = true;
              const alivePlayers = room.players.filter(p => p.isAlive);
              if (alivePlayers.every(p => p.hasLockedVote)) {
                room.timer = 0;
              }
            }
          });
        }

        if (room.timer > 0) {
          room.timer--;
        }

        if (room.timer <= 0) {
          switch (room.phase) {
            case GamePhase.REVEAL:
              await startPhase(room, GamePhase.INTRO, INTRO_TIMER);
              break;
            case GamePhase.INTRO:
              await startPhase(room, GamePhase.TRANSITION, 8);
              break;
            case GamePhase.TRANSITION:
              await startPhase(room, GamePhase.GOSSIP, GOSSIP_TIMER);
              break;
            case GamePhase.GOSSIP:
            case GamePhase.GOSSIP_2:
              if (room.isSecretActionWindow) {
                await nextGossipStep(room);
              } else {
                await processGossipQuestion(room);
              }
              break;
            case GamePhase.INTERROGATION_INTRO:
              await startPhase(room, GamePhase.INTERROGATION, 7);
              break;
            case GamePhase.INTERROGATION:
              if (room.isInterrogationQuestionWindow) {
                room.isInterrogationQuestionWindow = false;
                room.timer = 6;
                await emitState(room);
              } else {
                room.interrogationIndex++;
                if (room.interrogationIndex < room.gossipResults.length) {
                  await startPhase(room, GamePhase.INTERROGATION, 7);
                } else {
                  await startPhase(room, GamePhase.VOTING, VOTING_TIMER);
                }
              }
              break;
            case GamePhase.VOTING:
              await startPhase(room, GamePhase.RESULT, RESULT_TIMER);
              break;
            case GamePhase.RESULT:
              if (room.phase as any !== GamePhase.GAME_OVER) {
                const killerStillAlive = room.players.some(p => p.isAlive && p.role === Role.KILLER);
                if (killerStillAlive) {
                  room.roundCount++;
                  room.questionIndex = 0;
                  room.interrogationIndex = 0;
                  room.gossipResults = [];

                  const pool = [...GOSSIP_2_QUESTIONS];
                  const selected: string[] = [];
                  for (let i = 0; i < 3; i++) {
                    if (pool.length === 0) break;
                    const idx = Math.floor(Math.random() * pool.length);
                    selected.push(pool.splice(idx, 1)[0]);
                  }
                  room.gossipQuestions = selected;

                  await startPhase(room, GamePhase.GOSSIP_2, GOSSIP_TIMER);
                }
              }
              break;
          }
          continue;
        }

        await emitState(room);
      }
    } catch (error) {
      console.error("Error in game loop:", error);
    }
  }, 1000);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
