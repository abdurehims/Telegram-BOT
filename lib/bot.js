
const { Telegraf, Markup } = require("telegraf");
const { supabase, checked } = require("./db");

const required = [
  "BOT_TOKEN",
  "ADMIN_TELEGRAM_ID",
  "CHANNEL_ID",
  "WEBHOOK_SECRET"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID);
const CHANNEL_ID = process.env.CHANNEL_ID;

const bot = new Telegraf(process.env.BOT_TOKEN);

// Main menu
const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Start registration", "register")],
    [Markup.button.callback("My latest payment", "my_payment")]
  ]);

// Save student information
async function saveStudent(ctx, extra = {}) {
  const from = ctx.from;

  const payload = {
    telegram_id: from.id,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    updated_at: new Date().toISOString(),
    ...extra
  };

  return checked(
    supabase
      .from("students")
      .upsert(payload, { onConflict: "telegram_id" })
      .select()
      .single()
  );
}

// Get student
async function getStudent(id) {
  return checked(
    supabase
      .from("students")
      .select("*")
      .eq("telegram_id", id)
      .maybeSingle()
  );
}

// Update student state
async function setState(id, state, extra = {}) {
  return checked(
    supabase
      .from("students")
      .update({
        state,
        ...extra,
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", id)
      .select()
      .single()
  );
}

// Display courses
async function replyCourses(ctx, stream, semester) {
  const courses = await checked(
    supabase
      .from("courses")
      .select("name")
      .eq("stream", stream)
      .eq("semester", semester)
      .eq("active", true)
      .order("name")
  );

  if (!courses.length) {
    await ctx.reply(
      "No courses have been configured for this stream and semester yet. Please contact the admin."
    );
    return;
  }

  const list = courses
    .map((c, i) => `${i + 1}. ${c.name}`)
    .join("\n");

  await ctx.reply(
    `📚 *${stream} — ${semester}*\n\nThese are the courses included in your semester package:\n${list}\n\nYou are purchasing the complete semester package.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "Continue to payment",
            "continue_payment"
          )
        ]
      ])
    }
  );
}

// Start bot
bot.start(async (ctx) => {
  await saveStudent(ctx, { state: "start" });

  await ctx.reply(
    `Welcome ${ctx.from.first_name || "student"}! 👋\n\nThis bot helps you register for course materials and request access to our private channel.\n\nChoose an option below.`,
    mainMenu()
  );
});

// Registration
bot.action("register", async (ctx) => {
  await ctx.answerCbQuery();

  await saveStudent(ctx, {
    state: "select_stream",
    stream: null,
    semester: null
  });

  await ctx.reply(
    "Select your stream:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "Natural Science",
          "stream:Natural Sc."
        ),
        Markup.button.callback(
          "Social Science",
          "stream:Social Sc."
        )
      ]
    ])
  );
});

// Select stream
bot.action(
  /^stream:(Natural Sc\.|Social Sc\.)$/,
  async (ctx) => {
    await ctx.answerCbQuery();

    const stream = ctx.match[1];

    await setState(ctx.from.id, "select_semester", {
      stream,
      semester: null
    });

    await ctx.reply(
      "Select your semester:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "Semester 1",
            "semester:Semester 1"
          )
        ],
        [
          Markup.button.callback(
            "Semester 2",
            "semester:Semester 2"
          )
        ]
      ])
    );
  }
);

// Select semester
bot.action(/^semester:(Semester [12])$/, async (ctx) => {
  await ctx.answerCbQuery();

  const semester = ctx.match[1];

  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream) {
    return ctx.reply(
      "Please start registration again using /start."
    );
  }

  await setState(ctx.from.id, "review_courses", {
    semester
  });

  await replyCourses(ctx, student.stream, semester);
});

// Continue to payment
bot.action("continue_payment", async (ctx) => {
  await ctx.answerCbQuery();

  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream || !student.semester) {
    return ctx.reply(
      "Your registration is incomplete. Please use /start."
    );
  }

  await setState(ctx.from.id, "select_payment");

  await ctx.reply(
    "Choose your payment method:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("CBE", "payment:CBE")
      ],
      [
        Markup.button.callback("Telebirr", "payment:TELEBIRR")
      ]
    ])
  );
});

// Select payment method
bot.action(/^payment:(CBE|TELEBIRR)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const method = ctx.match[1];

  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream || !student.semester) {
    return ctx.reply(
      "Your registration is incomplete. Please use /start."
    );
  }

  const previous = await checked(
    supabase
      .from("payments")
      .select("id")
      .eq("telegram_id", ctx.from.id)
      .in("status", ["awaiting_screenshot", "pending"])
      .limit(1)
  );

  if (previous.length) {
    return ctx.reply(
      "You already have a payment request in progress. Please upload the screenshot or wait for the admin's review."
    );
  }

  const payment = await checked(
    supabase
      .from("payments")
      .insert({
        telegram_id: ctx.from.id,
        stream: student.stream,
        semester: student.semester,
        payment_method: method,
        amount: process.env.PAYMENT_AMOUNT
          ? Number(process.env.PAYMENT_AMOUNT)
          : null,
        status: "awaiting_screenshot"
      })
      .select()
      .single()
  );

  await setState(ctx.from.id, "awaiting_screenshot");

  const accountName =
    method === "CBE"
      ? process.env.CBE_ACCOUNT_NAME
      : process.env.TELEBIRR_ACCOUNT_NAME;

  const accountNumber =
    method === "CBE"
      ? process.env.CBE_ACCOUNT_NUMBER
      : process.env.TELEBIRR_ACCOUNT_NUMBER;

  await ctx.reply(
    `💳 *${method === "CBE" ? "Commercial Bank of Ethiopia (CBE)" : "Telebirr"} payment*\n\nAccount name: ${accountName || "Not configured"}\nAccount number: \`${accountNumber || "Not configured"}\`\nAmount: *${process.env.PAYMENT_AMOUNT || "Ask admin"} ${process.env.CURRENCY || "ETB"}*\n\nAfter making the payment, send a clear screenshot of the receipt here.\n\nPayment reference: \`${payment.id}\``,
    {
      parse_mode: "Markdown"
    }
  );
});

// Check latest payment
bot.action("my_payment", async (ctx) => {
  await ctx.answerCbQuery();

  const rows = await checked(
    supabase
      .from("payments")
      .select("stream,semester,payment_method,status,created_at")
      .eq("telegram_id", ctx.from.id)
      .order("created_at", { ascending: false })
      .limit(1)
  );

  if (!rows.length) {
    return ctx.reply(
      "You do not have a payment request yet."
    );
  }

  const p = rows[0];

  await ctx.reply(
    `Latest payment:\nStream: ${p.stream}\nSemester: ${p.semester}\nMethod: ${p.payment_method}\nStatus: ${p.status}`
  );
});

// Receive payment screenshot
bot.on("photo", async (ctx) => {
  const student = await getStudent(ctx.from.id);

  if (!student) {
    return ctx.reply(
      "Please start the bot first using /start."
    );
  }

  const rows = await checked(
    supabase
      .from("payments")
      .select("*")
      .eq("telegram_id", ctx.from.id)
      .eq("status", "awaiting_screenshot")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  if (!rows.length) {
    return ctx.reply(
      "I couldn't find a payment awaiting a screenshot. Please select your stream, semester and payment method first."
    );
  }

  const payment = rows[0];

  const photo =
    ctx.message.photo[ctx.message.photo.length - 1];

  await checked(
    supabase
      .from("payments")
      .update({
        screenshot_file_id: photo.file_id,
        status: "pending"
      })
      .eq("id", payment.id)
  );

  const username = ctx.from.username
    ? `@${ctx.from.username}`
    : "(no username)";

  const caption =
    `🧾 NEW PAYMENT — REVIEW REQUIRED\n\n` +
    `Student: ${ctx.from.first_name || ""} ${ctx.from.last_name || ""}\n` +
    `Username: ${username}\n` +
    `Telegram ID: ${ctx.from.id}\n` +
    `Stream: ${payment.stream}\n` +
    `Semester: ${payment.semester}\n` +
    `Payment: ${payment.payment_method}\n` +
    `Payment ID: ${payment.id}`;

  await ctx.telegram.sendPhoto(
    ADMIN_ID,
    photo.file_id,
    {
      caption,
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✅ Approve",
            `approve:${payment.id}`
          ),
          Markup.button.callback(
            "❌ Reject",
            `reject:${payment.id}`
          )
        ]
      ]).reply_markup
    }
  );

  await ctx.reply(
    "✅ Your payment screenshot has been sent to the admin for verification. I will notify you after it is reviewed."
  );
});

// Admin approves payment
bot.action(/^approve:([0-9a-f-]{36})$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery(
      "You are not authorized.",
      { show_alert: true }
    );
    return;
  }

  await ctx.answerCbQuery("Checking payment...");

  const paymentId = ctx.match[1];

  const rows = await checked(
    supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("status", "pending")
      .limit(1)
  );

  if (!rows.length) {
    return ctx.reply(
      "This payment has already been reviewed or does not exist."
    );
  }

  const payment = rows[0];

  const expiresAt =
    Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  const invite =
    await ctx.telegram.createChatInviteLink(
      CHANNEL_ID,
      {
        expire_date: expiresAt,
        member_limit: 1,
        name: `payment-${payment.id.slice(0, 8)}`
      }
    );

  await checked(
    supabase
      .from("payments")
      .update({
        status: "approved",
        reviewed_by: ctx.from.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", payment.id)
      .eq("status", "pending")
  );

  await checked(
    supabase
      .from("invite_links")
      .insert({
        payment_id: payment.id,
        telegram_id: payment.telegram_id,
        invite_link: invite.invite_link,
        expires_at: new Date(
          expiresAt * 1000
        ).toISOString()
      })
  );

  await ctx.telegram.sendMessage(
    payment.telegram_id,
    `🎉 Your payment has been approved!\n\nHere is your private channel invitation:\n${invite.invite_link}\n\n⚠️ This link can be used by ONE person and expires in 24 hours. Do not share it with anyone.\n\nIf it expires before you join, contact the admin.`
  );

  await ctx.editMessageCaption(
    `${ctx.callbackQuery.message.caption}\n\n✅ APPROVED by admin.`
  );
});

// Admin rejects payment
bot.action(/^reject:([0-9a-f-]{36})$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery(
      "You are not authorized.",
      { show_alert: true }
    );
    return;
  }

  await ctx.answerCbQuery();

  const paymentId = ctx.match[1];

  const rows = await checked(
    supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("status", "pending")
      .limit(1)
  );

  if (!rows.length) {
    return ctx.reply(
      "This payment has already been reviewed or does not exist."
    );
  }

  const payment = rows[0];

  await checked(
    supabase
      .from("payments")
      .update({
        status: "rejected",
        reviewed_by: ctx.from.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", payment.id)
      .eq("status", "pending")
  );

  await ctx.telegram.sendMessage(
    payment.telegram_id,
    "❌ Your payment could not be approved. Please check your receipt and contact the admin or start a new payment request."
  );

  await ctx.editMessageCaption(
    `${ctx.callbackQuery.message.caption}\n\n❌ REJECTED by admin.`
  );
});

// Error handling
bot.catch((err) => {
  console.error("Bot handler error:", err);
});

module.exports = { bot };
