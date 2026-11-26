# Telegram Student Course Payment Bot

A Telegram bot using Node.js, Telegraf, Vercel Functions and Supabase PostgreSQL.

## Important behavior

- Students choose NS or SS, then Semester 1 or Semester 2.
- The bot lists all active courses configured for that stream/semester.
- The student pays once for the complete semester package.
- The student chooses CBE or Telebirr and uploads a receipt screenshot.
- The admin receives the screenshot with Approve / Reject buttons.
- Approval creates a Telegram channel invite link with `member_limit: 1` and an expiry of 24 hours.
- One private Telegram channel is used for all approved students.

**Channel access note:** because this design uses one shared channel, every member who joins can see all content posted in that channel. The stream/semester selection is recorded for payment and administration; it does not create separate content permissions inside the channel.

## 1. Create Telegram bot and channel

1. Create a bot with [@BotFather](https://t.me/BotFather), copy its token.
2. Create a **private** Telegram channel.
3. Add the bot as an administrator and grant permission to invite users.
4. Find the channel ID (often begins with `-100`). You can use a Telegram ID helper bot or inspect a channel update after adding your bot.
5. Find your own numeric Telegram user ID. Set it as `ADMIN_TELEGRAM_ID`.

## 2. Create Supabase database

1. Create a project at https://supabase.com.
2. Open SQL Editor.
3. Run the complete contents of `sql/schema.sql`.
4. In Project Settings -> API, copy the Project URL and `service_role` key.
5. Keep the service-role key secret. Add it only as a Vercel environment variable.

Replace the example course names in the SQL with the real course names. Add more rows for each stream and semester. `semester` must be exactly `Semester 1` or `Semester 2`.

## 3. Deploy to Vercel

1. Put this project in a GitHub repository.
2. Import that repository into Vercel.
3. Add all variables from `.env.example` in Vercel Project Settings -> Environment Variables.
4. Set `APP_URL` to your production Vercel URL, for example `https://your-bot-project.vercel.app`.
5. Redeploy after adding/changing environment variables.

Use strong random values for `WEBHOOK_SECRET` and `SETUP_SECRET`. Telegram's webhook secret token must contain 1-256 characters and only use A-Z, a-z, 0-9, underscore and hyphen. Use that character set for `WEBHOOK_SECRET`.

## 4. Register Telegram webhook

After deployment, open this URL in your browser once:

`https://YOUR-VERCEL-DOMAIN.vercel.app/api/setup-webhook?key=YOUR_SETUP_SECRET`

You should receive JSON with `success: true`. Do not share the setup URL because it contains your setup secret.

## 5. Test

1. Open your bot and send `/start`.
2. Choose stream and semester.
3. Confirm the course list is correct.
4. Choose CBE or Telebirr.
5. Upload a payment screenshot.
6. Check the admin account for the review message.
7. Approve using the admin account.
8. Confirm the student receives a link and that the link is single-use and expires in 24 hours.

## Environment variables

See `.env.example`. Set `PAYMENT_AMOUNT` and `CURRENCY` to the price of the complete semester package. Never commit a real `.env` file or paste bot/database secrets into chats or GitHub.

## Operational notes and limitations

- Vercel Hobby is free but subject to plan quotas and its personal/non-commercial-use policy. Check the current plan terms before using it for a paid student service.
- Supabase Free has storage/compute limits and may pause inactive projects. Check current terms and backups.
- Telegram does not verify bank transfers automatically. The admin manually checks the screenshot and approves/rejects.
- This starter accepts photo uploads. If students send receipts as documents/PDFs, add a `document` handler.
- If a student loses the link or it expires, the admin must currently handle the case manually. An automated resend/recovery flow can be added.
- The starter records the invite URL but does not monitor whether the student actually joined. Add Telegram `chat_member` updates if you need join tracking.
- Telegram invitation links are limited to one successful join and expire after 24 hours; they do not remove the member after 24 hours.
- The `processed_updates` table prevents duplicate update processing. Review database retention periodically if the bot receives very high traffic.
