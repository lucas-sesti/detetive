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
