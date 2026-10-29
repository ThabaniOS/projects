// Builds the bot's dependencies from Vercel environment variables.

import { createGitHub } from "./github.mjs";
import { createTelegram } from "./telegram.mjs";

export const REQUIRED_ENV = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ALLOWED_CHAT_ID",
  "GITHUB_TOKEN",
  "ANTHROPIC_API_KEY",
];

export function missingEnv(env = process.env) {
  return REQUIRED_ENV.filter((k) => !env[k]);
}

export function depsFromEnv(env = process.env) {
  const [owner, repo] = (env.GITHUB_REPO ?? "ThabaniOS/projects").split("/");
  return {
    gh: createGitHub({ token: env.GITHUB_TOKEN, owner, repo, branch: env.GITHUB_BRANCH ?? "master" }),
    tg: createTelegram({ token: env.TELEGRAM_BOT_TOKEN }),
    allowedChatId: env.TELEGRAM_ALLOWED_CHAT_ID,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.CLAUDE_MODEL ?? "claude-haiku-5-5",
  };
}
