# Course Channel Bot

Telegram bot that sells access to private course channels.

## Flow
1. User: `/start` → semester → stream → course list (added by admin)
2. Bot shows price + Telebirr and CBE account details
3. User taps **Submit receipt** and sends a screenshot
4. Receipt goes to all admins with **Approve / Reject** buttons
5. On approve, the bot sends a personal invite link (24h expiry). Only the paying user can use it, once.

## Setup
1. Create the bot with @BotFather and copy the token.
2. Add the bot as **administrator** to each private channel with the permission **Invite users via link**.
3. Get the channel ID (e.g. `-1001234567890`): forward a channel post to @userinfobot or @RawDataBot.
4. Install and run (Node 20+):
   ```
   cp .env.example .env     # fill in token, admin IDs, payment details
   npm install
   npm start
   ```

## Admin commands (admins only)
- `/addcourse Semester | Stream | Course name | Price | Channel ID`
- `/courses` list all courses with IDs
- `/delcourse <id>`

## Deploy
Needs a long-running process (Railway, Render, a VPS). Vercel is not suitable for this long-polling bot. `bot.db` (SQLite) must be on persistent storage.
