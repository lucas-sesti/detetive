import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearMessages } from "./_db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { roomId, playerId } = req.body;
  if (!roomId || !playerId) return res.status(400).json({ error: "Missing fields" });

  await clearMessages(roomId.toUpperCase(), playerId);
  res.json({ ok: true });
}
