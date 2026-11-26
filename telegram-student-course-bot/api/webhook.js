const { bot } = require("../lib/bot");
const { supabase } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (receivedSecret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  const update = req.body;
  if (!update || typeof update.update_id !== "number") {
    return res.status(400).send("Invalid Telegram update");
  }

  try {
    // Ignore duplicate webhook deliveries. Telegram may retry if a response is lost.
    const { error: insertError } = await supabase
      .from("processed_updates")
      .insert({ update_id: update.update_id });

    if (insertError && insertError.code === "23505") {
      return res.status(200).send("Duplicate update ignored");
    }
    if (insertError) throw insertError;

    await bot.handleUpdate(update);
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    // Remove the update marker so Telegram's retry can process it.
    await supabase.from("processed_updates").delete().eq("update_id", update.update_id);
    return res.status(500).send("Webhook processing failed");
  }
};