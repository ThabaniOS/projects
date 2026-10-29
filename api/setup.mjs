// One-click setup and health check, protected by the webhook secret.
//   /api/setup?secret=…                    health check: env vars, bot, webhook, GitHub, Claude model
//   /api/setup?secret=…&action=connect     point the Telegram webhook here (cutover from n8n)
//   /api/setup?secret=…&action=disconnect  remove the webhook (then re-activate the n8n workflow to roll back)

import { depsFromEnv, missingEnv, REQUIRED_ENV } from "../lib/env.mjs";

const COMMANDS = [
  { command: "focus", description: "Top 5 next tasks" },
  { command: "p", description: "One project, e.g. /p LEO" },
  { command: "list", description: "All projects" },
  { command: "help", description: "How to use the bot" },
];

export default async function handler(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) return res.status(401).json({ error: "add ?secret=<TELEGRAM_WEBHOOK_SECRET>" });

  const missing = missingEnv();
  const report = { env: Object.fromEntries(REQUIRED_ENV.map((k) => [k, missing.includes(k) ? "MISSING" : "set"])) };
  if (missing.length) return res.status(200).json(report);

  const { gh, tg, model, apiKey } = depsFromEnv();
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? req.headers["x-forwarded-host"] ?? req.headers.host;
  const webhookUrl = `https://${host}/api/telegram`;

  try {
    const action = req.query.action ?? "info";
    if (action === "connect") {
      await tg.call("setWebhook", { url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"] });
      await tg.call("setMyCommands", { commands: COMMANDS });
      report.connected = webhookUrl;
    } else if (action === "disconnect") {
      await tg.call("deleteWebhook", {});
      report.disconnected = true;
    }

    report.bot = (await tg.call("getMe", {})).username;
    const info = await tg.call("getWebhookInfo", {});
    report.webhook = {
      url: info.url || "(none)",
      points_here: info.url === webhookUrl,
      pending_updates: info.pending_update_count,
      last_error: info.last_error_message ?? null,
    };

    const status = await gh.getFile("status.json");
    report.github = status ? `ok — ${JSON.parse(status.content).projects.length} projects in status.json` : "status.json not found";

    const m = await fetch(`https://api.anthropic.com/v1/models/${model}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    report.claude = m.ok ? `ok — ${model}` : `problem — ${m.status} for model ${model}`;
  } catch (e) {
    report.error = e.message;
  }
  return res.status(200).json(report);
}
