// Telegram webhook. Telegram POSTs every message and button press here.

import { createBot } from "../lib/bot.mjs";
import { depsFromEnv, missingEnv } from "../lib/env.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ThabaniOS bot webhook. POST only.");

  // Only Telegram knows this secret (set via /api/setup?action=connect).
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }

  const missing = missingEnv();
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    return res.status(200).json({ ok: false, missing }); // 200 so Telegram doesn't retry forever
  }

  const bot = createBot(depsFromEnv());
  try {
    const update = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update ?? {});
  } catch (e) {
    console.error(e);
  }
  return res.status(200).json({ ok: true });
}
