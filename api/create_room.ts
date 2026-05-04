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
