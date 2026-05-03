import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GamePhase, Role, Item, Player, GameState, SecretActionType, SecretActionPayload } from "./src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const GOSSIP_TIMER = 300; 
const GOSSIP_VOTING_TIMER = 30;
const REVEAL_TIMER = 10; // Reduzido para dar tempo de ler, mas ser rápido
const INTRO_TIMER = 15;
const VOTING_TIMER = 60;
const RESULT_TIMER = 15;
const AVATARS = ['bibs', 'gb', 'lavis', 'lucas', 'mat', 'mel', '🤵', '💃'];

const ITEMS_POOL = Object.values(Item).filter(i => i !== Item.KNIFE);

const QUESTIONS = [
  "Quem é o mais provável de ser o assassino?",
  "Quem está com o sorriso mais suspeito?",
  "Quem é o mais falante?",
  "Quem está mais quieto?",
  "Quem está mais agitado?"
];

const GOSSIP_2_QUESTIONS = [
  "Quem defendeu mais um suspeito?",
  "Quem foi que mais argumentou na votação?",
  "Quem foi o mais calado?",
  "Quem está agindo de forma suspeita?"
];

const INTERROGATION_QUESTIONS = [
  "Conte o que Sabes",
  "Você trocou algum item?",
  "Você roubou algum item?",
  "Você incriminou alguém?"
];

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const rooms = new Map<string, GameState>();
  const playerSockets = new Map<string, string>(); // socketId -> roomId

  io.on("connection", (socket) => {
    socket.on("create_room", ({ nickname, avatar }) => {
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

      rooms.set(roomId, newState);
      playerSockets.set(socket.id, roomId);
      socket.join(roomId);
      socket.emit("room_created", newState);
    });

    socket.on("join_room", ({ roomId, nickname, avatar }) => {
      const normalizedRoomId = roomId.toUpperCase();
      const room = rooms.get(normalizedRoomId);
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
      playerSockets.set(socket.id, normalizedRoomId);
      socket.join(normalizedRoomId);
      emitState(room);
    });

    socket.on("add_bot", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
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
        // Safe fallback if somehow we run out of names
        botNickname = `Convidado ${Math.floor(Math.random() * 999)} (Bot)`;
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
      emitState(room);
    });

    socket.on("reveal_role", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room || room.phase !== GamePhase.REVEAL) return;
      
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.roleRevealed = true;
        player.itemVisible = true;

        // Se for o último a revelar, reduz o tempo para 5 segundos
        const allRevealed = room.players.filter(p => !p.id.startsWith('bot_')).every(p => p.roleRevealed);
        if (allRevealed && room.timer > 5) {
          room.timer = 5;
        }

        emitState(room);
      }
    });

    socket.on("start_game", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room) return;
      const requester = room.players.find(p => p.id === socket.id);
      if (!requester?.isHost) return;
      if (room.phase !== GamePhase.LOBBY) return;
      if (room.players.length < 4) {
        socket.emit("event_message", "Mínimo de 4 jogadores para iniciar!");
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

      // Notify killers about each other
      const killers = room.players.filter(p => p.role === Role.KILLER);
      if (killers.length > 1) {
        killers.forEach(k => {
          const others = killers.filter(other => other.id !== k.id);
          const partnerNames = others.map(o => o.nickname).join(", ");
          const msg = `Seu parceiro assassino é: ${partnerNames}. Trabalhem juntos para fugir da mansão!`;
          k.logs.push(msg);
          // Use 'incriminated' type for a red, urgent notification
          k.notification = { message: msg, type: 'incriminated' };
        });
      }

      room.questionIndex = 0;
      room.roundCount = 1;
      room.interrogationIndex = 0;
      room.hasTriggeredRandomEvent = false;
      room.gossipResults = [];
      refreshGossipQuestions(room);
      startPhase(room, GamePhase.REVEAL, REVEAL_TIMER); 
    });

    socket.on("gossip_vote", (targetId) => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
         // Não pode votar em si mesmo na fofoca
         if (player.id === targetId) return;

         player.gossipVote = targetId;
         emitState(room);
         
         // Check if all alive players voted
         const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
         const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
         
         // Simulate bots voting if they haven't
         bots.forEach(b => {
           if (!b.gossipVote) {
             const others = room.players.filter(o => o.id !== b.id && o.isAlive);
             b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
           }
         });

         const allRealPlayersVoted = alivePlayers.every(p => p.gossipVote);
         if (allRealPlayersVoted && !room.isSecretActionWindow) {
           processGossipQuestion(room);
         }
      }
    });

    socket.on("secret_action", (payload: SecretActionPayload) => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
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
        
        // Notify both players if they are real
        if (!p1.id.startsWith('bot_')) {
          const msg = `Seu item foi trocado! Agora você tem: ${p1.item}`;
          io.to(p1.id).emit("event_message", msg);
          if (!p1.logs) p1.logs = [];
          p1.logs.push(msg);
          p1.notification = { message: msg, type: 'swapped' };
        }
        if (!p2.id.startsWith('bot_')) {
          const msg = `Seu item foi trocado! Agora você tem: ${p2.item}`;
          io.to(p2.id).emit("event_message", msg);
          if (!p2.logs) p2.logs = [];
          p2.logs.push(msg);
          p2.notification = { message: msg, type: 'swapped' };
        }
      };

      switch (payload.type) {
        case SecretActionType.SNOOP:
          const resultItem = (target1.hasKnife || target1.item === Item.KNIFE) ? Item.KNIFE : target1.item;
          const snoopMsg = `Investigação: ${target1.nickname} possui o item ${resultItem}`;
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
          const stealMsg = `Você roubou o item de ${target1.nickname}! Agora tem: ${actor.item}`;
          socket.emit("event_message", stealMsg);
          if (!actor.logs) actor.logs = [];
          actor.logs.push(stealMsg);
          if (!target1.id.startsWith('bot_')) {
            const stolenMsg = `Seu item foi roubado! Agora você tem: ${target1.item}`;
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
          actor.logs.push(`Você trocou de item com ${target1.nickname}`);
          break;
        case SecretActionType.SHUFFLE:
          if (target2) {
            swapItems(target1, target2);
            detail = `shuffled items of ${target1.nickname} and ${target2.nickname}`;
            if (!actor.logs) actor.logs = [];
            actor.logs.push(`Você embaralhou os itens de ${target1.nickname} e ${target2.nickname}`);
          }
          break;
        case SecretActionType.ALIBI:
          const alibiMsg = `Álibi confirmado: Você e ${target1.nickname} estão seguros.`;
          socket.emit("event_message", alibiMsg);
          if (!actor.logs) actor.logs = [];
          actor.logs.push(alibiMsg);
          if (!target1.id.startsWith('bot_')) {
            io.to(target1.id).emit("event_message", alibiMsg);
            if (!target1.logs) target1.logs = [];
            target1.logs.push(alibiMsg);
          }
          detail = `confirmed alibi with ${target1.nickname}`;
          break;
        case SecretActionType.PLANT_EVIDENCE:
          if (!actor.usedPlantEvidence && actor.hasKnife) {
            target1.isIncriminated = true;
            target1.item = Item.KNIFE; // Passa a ter o item da faca
            // Assassinos mantêm sua faca, então não definimos hasKnife como false
            actor.usedPlantEvidence = true;
            const plantMsg = `Você incriminou ${target1.nickname}!`;
            socket.emit("event_message", plantMsg);
            if (!actor.logs) actor.logs = [];
            actor.logs.push(plantMsg);
            if (!target1.id.startsWith('bot_')) {
              io.to(target1.id).emit("event_message", "VOCÊ FOI INCRIMINADO!");
              if (!target1.logs) target1.logs = [];
              target1.logs.push("Alguém plantou evidências contra você!");
              target1.notification = { message: "Alguém plantou evidências contra você!", type: 'incriminated' };
            }
            detail = `planted evidence on ${target1.nickname}`;
          }
          break;
        case SecretActionType.SKIP:
          detail = `chose not to act now`;
          if (!actor.logs) actor.logs = [];
          actor.logs.push(`Você decidiu não agir neste momento.`);
          break;
      }

      actor.canPerformSecretAction = false;
      room.lastAction = { type: payload.type, actor: actor.nickname, details: detail };
      emitState(room);
    });

    socket.on("skip_interrogation", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room || (room.phase !== GamePhase.INTERROGATION && room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
        if (room.phase === GamePhase.INTERROGATION) {
          if (room.isInterrogationQuestionWindow) return;
          const currentSuspectId = room.gossipResults[room.interrogationIndex]?.mostVotedId;
          if (socket.id === currentSuspectId) {
            room.timer = 0;
            emitState(room);
          }
          return;
        }

        player.isReadyToSkip = true;
        emitState(room);

        const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        if (alivePlayers.every(p => p.isReadyToSkip)) {
          // In Gossip phases
          if (room.isSecretActionWindow) {
            nextGossipStep(room);
          } else {
            // Force bots to vote if they haven't
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
            bots.forEach(b => {
              if (!b.gossipVote) {
                const others = room.players.filter(o => o.id !== b.id && o.isAlive);
                if (others.length > 0) {
                  b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                }
              }
            });
            processGossipQuestion(room);
          }
        }
      }
    });

    socket.on("skip_gossip", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room || (room.phase !== GamePhase.GOSSIP && room.phase !== GamePhase.GOSSIP_2)) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive) {
        player.isReadyToSkip = true;
        emitState(room);

        // Check if all alive players are ready to skip
        const alivePlayers = room.players.filter(p => !p.id.startsWith('bot_') && p.isAlive);
        const allReady = alivePlayers.every(p => p.isReadyToSkip);

        if (allReady) {
          if (room.isSecretActionWindow) {
            nextGossipStep(room);
          } else {
            // Force bots to vote if they haven't
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive);
            bots.forEach(b => {
              if (!b.gossipVote) {
                const others = room.players.filter(o => o.id !== b.id && o.isAlive);
                if (others.length > 0) {
                  b.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                }
              }
            });
            processGossipQuestion(room);
          }
        }
      }
    });

    socket.on("toggle_item_exposure", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.itemExposed = !player.itemExposed;
        emitState(room);
      }
    });

    socket.on("clear_notification", () => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room) return;
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.notification = null;
        emitState(room);
      }
    });

    socket.on("vote", (targetId) => {
      const roomId = playerSockets.get(socket.id);
      const room = roomById(roomId);
      if (!room || room.phase !== GamePhase.VOTING) return;

      const player = room.players.find(p => p.id === socket.id);
      if (player && player.isAlive && !player.hasLockedVote) {
        // Can't vote for self
        if (player.id === targetId) return;
        
        player.votedFor = targetId;
        emitState(room);
      }
    });

    socket.on("lock_vote", (targetId) => {
        const roomId = playerSockets.get(socket.id);
        const room = roomById(roomId);
        if (!room || room.phase !== GamePhase.VOTING) return;
  
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.isAlive && !player.hasLockedVote) {
          if (player.id === targetId) return;
          const target = room.players.find(p => p.id === targetId);
          if (!target || !target.isAlive) return;
          player.votedFor = targetId;
          player.hasLockedVote = true;
          
          // Bots lock their votes automatically if they chose
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
          
          emitState(room);

          const alivePlayersVisible = room.players.filter(p => p.isAlive);
          if (alivePlayersVisible.every(p => p.hasLockedVote)) {
            room.timer = 0; 
          }
        }
    });

    socket.on("disconnect", () => {
      const roomId = playerSockets.get(socket.id);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.players = room.players.filter(p => p.id !== socket.id);
          if (room.players.length === 0) {
            rooms.delete(roomId);
          } else {
            const hadHost = room.players.some(p => p.isHost);
            if (!hadHost) {
              const newHost = room.players.find(p => !p.id.startsWith('bot_'));
              if (newHost) {
                newHost.isHost = true;
              } else {
                rooms.delete(roomId);
                return;
              }
            }
            emitState(room);
          }
        }
        playerSockets.delete(socket.id);
      }
    });
  });

  function roomById(id?: string) {
    return id ? rooms.get(id) : null;
  }

  function refreshGossipQuestions(room: GameState) {
    room.gossipQuestions = [...QUESTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
  }

  function emitState(room: GameState, event: string = "state_updated") {
    room.players.forEach(p => {
      if (!p.id.startsWith('bot_')) {
        const scrubbedPlayers = room.players.map(player => {
          const isOwner = player.id === p.id;
          const showRole = isOwner || room.phase === GamePhase.GAME_OVER;
          const showItem = isOwner || room.phase === GamePhase.GAME_OVER || player.itemVisible;
          const showKnife = (isOwner && player.hasKnife) || room.phase === GamePhase.GAME_OVER;

          return {
            ...player,
            // Security: Hide sensitive data if not the owner or not game over
            role: showRole ? player.role : undefined,
            item: showItem ? player.item : undefined,
            hasKnife: showKnife ? player.hasKnife : undefined,
            assignedSecretAction: isOwner ? player.assignedSecretAction : undefined,
            logs: isOwner ? player.logs : [],
            // Gossip and Voting scrubbing
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

  function processGossipQuestion(room: GameState) {
    const votes: Record<string, number> = {};
    room.players.forEach(p => {
      if (p.gossipVote) {
        votes[p.gossipVote] = (votes[p.gossipVote] || 0) + 1;
      }
    });

    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const winnerId = sorted.length > 0 ? sorted[0][0] : null;
    const winnerName = winnerId ? room.players.find(p => p.id === winnerId)?.nickname || "Ninguém" : "Ninguém";

    room.gossipResults.push({
      question: room.currentQuestion!,
      mostVotedId: winnerId,
      mostVotedName: winnerName
    });

    if (room.phase === GamePhase.GOSSIP_2) {
      // In Gossip 2 there are no secret actions, go directly to next step
      nextGossipStep(room);
      return;
    }

    // Instead of going directly to next question, go to Secret Action Window
    room.phase = GamePhase.GOSSIP;
    room.isSecretActionWindow = true;
    room.timer = 20; // 20 seconds for secret actions
    
    // Reset skip status for the secret action window
    room.players.forEach(p => p.isReadyToSkip = false);

    // Assign actions to the current group of players (only in Round 1)
    if (room.roundCount === 1) {
      const alivePlayers = room.players.filter(p => p.isAlive);
      const groupSize = Math.ceil(alivePlayers.length / 3);
      const startIndex = (room.questionIndex) * groupSize;
      const group = alivePlayers.slice(startIndex, startIndex + groupSize);
      
      // Regular group actions
      group.forEach(p => {
        p.canPerformSecretAction = true;
        
        // Random actions for everyone in the group
        const possibleActions = [
          SecretActionType.SNOOP,
          SecretActionType.STEAL,
          SecretActionType.SWAP,
          SecretActionType.SHUFFLE
        ];
        if (p.role === Role.INNOCENT) possibleActions.push(SecretActionType.ALIBI);
        
        p.assignedSecretAction = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      });

      // Special handling for Killers: They always get PLANT_EVIDENCE if they haven't used it
      const allKillers = room.players.filter(p => p.isAlive && p.role === Role.KILLER);
      allKillers.forEach(k => {
        if (!k.usedPlantEvidence) {
          k.canPerformSecretAction = true;
          k.assignedSecretAction = SecretActionType.PLANT_EVIDENCE;
        }
      });
    }

    emitState(room);
  }

  function nextGossipStep(room: GameState) {
    room.isSecretActionWindow = false;
    room.players.forEach(p => {
      p.canPerformSecretAction = false;
      p.assignedSecretAction = undefined;
    });

    room.questionIndex++;
    const maxQuestions = (room.phase === GamePhase.GOSSIP_2) ? 3 : 3; // Both use 3 questions per round normally
    
    // Determine the max questions for the current phase
    // User said Gossip 2 should have 3 questions.
    const currentMax = 3; 

    if (room.questionIndex < currentMax) {
      startPhase(room, room.phase as GamePhase, room.phase === GamePhase.GOSSIP_2 ? GOSSIP_TIMER : GOSSIP_TIMER);
    } else {
      room.gossipResults = room.gossipResults.filter(r => r.mostVotedId);
      if (room.gossipResults.length === 0) {
        startPhase(room, GamePhase.VOTING, VOTING_TIMER);
      } else {
        room.interrogationIndex = 0;
        startPhase(room, GamePhase.INTERROGATION, 6);
      }
    }
  }

  function startPhase(room: GameState, phase: GamePhase, duration: number) {
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

      // Random event only in phase 1 (GOSSIP) and after first question
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
       room.isInterrogationQuestionWindow = true; // Start with the question popup
       room.timer = 7; // 7 seconds for the popup
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

    emitState(room, "phase_started");
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
          const msg = `Seu item foi trocado! Agora você tem: ${p.item}`;
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
          const stolenMsg = `Seu item foi roubado! Agora você tem: ${target.item}`;
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
            io.to(target.id).emit("event_message", "VOCÊ FOI INCRIMINADO!");
            if (!target.logs) target.logs = [];
            target.logs.push("Alguém plantou evidências contra você!");
            target.notification = { message: "Alguém plantou evidências contra você!", type: 'incriminated' };
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
    const events = ["A luz apagou", "Testemunha"];
    const event = events[Math.floor(Math.random() * events.length)];
    
    let message = "";

    if (event === "A luz apagou") {
      message = "A luz apagou! Itens foram trocados entre alguns inocentes.";
      const aliveInnocents = room.players.filter(p => p.isAlive && p.role === Role.INNOCENT);
      if (aliveInnocents.length > 1) {
        // Proper shuffle
        const items = aliveInnocents.map(p => p.item!);
        for (let i = items.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [items[i], items[j]] = [items[j], items[i]];
        }

        aliveInnocents.forEach((p, i) => {
          p.item = items[i];
          if (!p.logs) p.logs = [];
          const logMsg = `Luzes apagaram! Seu novo item é: ${p.item}`;
          p.logs.push(logMsg);
          
          if (!p.id.startsWith('bot_')) {
             p.notification = { message: logMsg, type: 'swapped' };
          }
        });
      }
    } else if (event === "Testemunha") {
      const innocents = room.players.filter(p => p.role === Role.INNOCENT);
      if (innocents.length > 0) {
        const victim = innocents[Math.floor(Math.random() * innocents.length)];
        message = `Testemunha: Foi visto que ${victim.nickname} possui o item ${victim.item}`;
        // Add to everyone's logs
        room.players.forEach(p => {
          if (!p.logs) p.logs = [];
          p.logs.push(message);
        });
      }
    }

    room.activePopup = { message, type: "event" };
    // Clear popup after 5 seconds
    setTimeout(() => {
      const currentRoom = rooms.get(room.roomId);
      if (currentRoom && currentRoom.activePopup?.message === message) {
        currentRoom.activePopup = null;
        emitState(currentRoom);
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
          room.eventMessage = "Um inocente foi pego indevidamente";
        } else {
          room.eventMessage = "Um Assassino foi pego";
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

  setInterval(() => {
    try {
      rooms.forEach((room) => {
        if (room.phase === GamePhase.LOBBY || room.phase === GamePhase.GAME_OVER) return;

        // Handle Bot Voting in Gossip
        if (room.phase === GamePhase.GOSSIP || room.phase === GamePhase.GOSSIP_2) {
          if (room.isSecretActionWindow) {
             const aliveBotsWithActions = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && p.canPerformSecretAction);
             aliveBotsWithActions.forEach(bot => {
               if (Math.random() < 0.1) {
                 executeBotAction(room, bot);
                 emitState(room);
               }
             });

             if (room.timer <= 0) {
               nextGossipStep(room);
             }
          } else {
            const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.gossipVote);
            bots.forEach(bot => {
               if (Math.random() < 0.3) { // 30% chance each tick to vote
                 const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
                 bot.gossipVote = others[Math.floor(Math.random() * others.length)].id;
                 emitState(room);
                 
                 // Check if all voted
                 const alivePlayers = room.players.filter(p => p.isAlive);
                 if (alivePlayers.every(p => p.gossipVote) && !room.isSecretActionWindow) {
                   processGossipQuestion(room);
                 }
               }
            });
          }
        }

        // Handle Bot Voting in Final Voting
        if (room.phase === GamePhase.VOTING) {
          const bots = room.players.filter(p => p.id.startsWith('bot_') && p.isAlive && !p.hasLockedVote);
          bots.forEach(bot => {
            if (Math.random() < 0.2) { // 20% chance each tick to lock vote
              const others = room.players.filter(o => o.id !== bot.id && o.isAlive);
              bot.votedFor = others[Math.floor(Math.random() * others.length)].id;
              bot.hasLockedVote = true;
              emitState(room);
              
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
              startPhase(room, GamePhase.INTRO, INTRO_TIMER);
              break;
            case GamePhase.INTRO:
              startPhase(room, GamePhase.TRANSITION, 4);
              break;
            case GamePhase.TRANSITION:
              startPhase(room, GamePhase.GOSSIP, GOSSIP_TIMER);
              break;
            case GamePhase.GOSSIP:
            case GamePhase.GOSSIP_2:
              // Gossip usually ends when all vote, but timer is fallback
              if (room.isSecretActionWindow) {
                nextGossipStep(room);
              } else {
                processGossipQuestion(room);
              }
              break;
            case GamePhase.INTERROGATION:
              if (room.isInterrogationQuestionWindow) {
                room.isInterrogationQuestionWindow = false;
                room.timer = 6; // Now give 6 seconds for defense
                emitState(room);
              } else {
                room.interrogationIndex++;
                if (room.interrogationIndex < room.gossipResults.length) {
                  startPhase(room, GamePhase.INTERROGATION, 7); // Start next interrogation with 7s popup
                } else {
                  startPhase(room, GamePhase.VOTING, VOTING_TIMER);
                }
              }
              break;
            case GamePhase.VOTING:
              startPhase(room, GamePhase.RESULT, RESULT_TIMER);
              break;
            case GamePhase.RESULT:
              if (room.phase as any !== GamePhase.GAME_OVER) {
                const killerStillAlive = room.players.some(p => p.isAlive && p.role === Role.KILLER);
                
                if (killerStillAlive) {
                   // Todos os sobreviventes vão para a segunda fase de gossip antes da próxima votação
                   room.roundCount++;
                   room.questionIndex = 0;
                   room.interrogationIndex = 0;
                   room.gossipResults = [];
                   
                   // Seleciona 3 questões de Gossip 2
                   const pool = [...GOSSIP_2_QUESTIONS];
                   const selected: string[] = [];
                   for (let i = 0; i < 3; i++) {
                     if (pool.length === 0) break;
                     const idx = Math.floor(Math.random() * pool.length);
                     selected.push(pool.splice(idx, 1)[0]);
                   }
                   room.gossipQuestions = selected;
                   
                   startPhase(room, GamePhase.GOSSIP_2, GOSSIP_TIMER);
                }
              }
              break;
          }
        }
        
        // Emit update every tick to keep timers in sync
        emitState(room);
      });
    } catch (error) {
      console.error("Error in game loop:", error);
    }
  }, 1000);

  // Vite middleware for development
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
