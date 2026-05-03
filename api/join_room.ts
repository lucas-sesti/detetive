import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, saveRoom, scrubStateFor } from "./_db.js";
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
  }

  res.json(scrubStateFor(room, playerId));
}
