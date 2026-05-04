import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, saveRoom, deleteRoom, saveScrubbedStateForAll, pushMessage } from "./_db.js";
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
