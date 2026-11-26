module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  if (!process.env.SETUP_SECRET || req.query.key !== process.env.SETUP_SECRET) {
    return res.status(401).send("Unauthorized");
  }
  const { Telegraf } = require("telegraf");
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!appUrl || !process.env.WEBHOOK_SECRET) {
    return res.status(500).json({ error: "APP_URL or WEBHOOK_SECRET is missing" });
  }
  try {
    const result = await bot.telegram.setWebhook(`${appUrl}/api/webhook`, {
      secret_token: process.env.WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"]
    });
    return res.status(200).json({ success: result, webhook: `${appUrl}/api/webhook` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Could not configure Telegram webhook" });
  }
};