// Minimal Telegram Bot API client.

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LIMIT = 4000; // Telegram's hard limit is 4096 characters

function clip(text) {
  return text.length > LIMIT ? text.slice(0, LIMIT - 1) + "…" : text;
}

function keyboard(buttons) {
  if (!buttons) return undefined;
  return { inline_keyboard: buttons.map((row) => row.map(([text, data]) => ({ text, callback_data: data }))) };
}

export function createTelegram({ token, fetchImpl = fetch }) {
  const url = (m) => `https://api.telegram.org/bot${token}/${m}`;

  async function call(method, payload) {
    const res = await fetchImpl(url(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result;
  }

  return {
    call,
    /** html: true sends with HTML parse mode (escape your own text). */
    send: (chat_id, text, { html = false, buttons, replyTo } = {}) =>
      call("sendMessage", {
        chat_id,
        text: clip(text),
        ...(html ? { parse_mode: "HTML" } : {}),
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard(buttons),
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      }),
    edit: (chat_id, message_id, text, { html = false, buttons } = {}) =>
      call("editMessageText", {
        chat_id,
        message_id,
        text: clip(text),
        ...(html ? { parse_mode: "HTML" } : {}),
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard(buttons) ?? { inline_keyboard: [] },
      }),
    answer: (callback_query_id, text) => call("answerCallbackQuery", { callback_query_id, ...(text ? { text } : {}) }),
    typing: (chat_id) => call("sendChatAction", { chat_id, action: "typing" }).catch(() => {}),
    async sendDocument(chat_id, filename, content, caption) {
      const form = new FormData();
      form.append("chat_id", String(chat_id));
      if (caption) form.append("caption", caption);
      form.append("document", new Blob([content], { type: "text/markdown" }), filename);
      const res = await fetchImpl(url("sendDocument"), { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(`Telegram sendDocument: ${data.description ?? res.status}`);
      return data.result;
    },
  };
}
