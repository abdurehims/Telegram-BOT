
const { bot } = require("../lib/bot");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  // Verify setup secret
  const key = req.query.key;

  if (!key || key !== process.env.SETUP_SECRET) {
    return res.status(401).json({
      ok: false,
      message: "Invalid setup secret"
    });
  }

  if (!process.env.APP_URL || !process.env.WEBHOOK_SECRET) {
    return res.status(500).json({
      ok: false,
      message: "Missing APP_URL or WEBHOOK_SECRET"
    });
  }

  try {
    const appUrl = process.env.APP_URL.replace(/\/$/, "");

    const webhookUrl = `${appUrl}/api/webhook`;

    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: process.env.WEBHOOK_SECRET
    });

    return res.status(200).json({
      ok: true,
      message: "Telegram webhook registered successfully!",
      webhook_url: webhookUrl
    });

  } catch (error) {
    console.error("Webhook setup error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
};
