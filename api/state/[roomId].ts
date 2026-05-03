import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRoom, scrubStateFor } from "../_db.js";

const playerMessages = new Map<string, { type: string; data: unknown }[]>();

export function pushMessage(playerId: string, type: string, data: unknown) {
  if (!playerMessages.has(playerId)) playerMessages.set(playerId, []);
  playerMessages.get(playerId)!.push({ type, data });
}

export function flushMessages(playerId: string) {
  const msgs = playerMessages.get(playerId) ?? [];
  playerMessages.delete(playerId);
  return msgs;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const playerId = req.headers["x-player-id"] as string;
  const roomId = (req.query.roomId as string).toUpperCase();

  const room = await getRoom(roomId);
  if (!room) return res.status(404).json({ error: "Not found" });

  res.json({ state: scrubStateFor(room, playerId), messages: flushMessages(playerId) });
}
