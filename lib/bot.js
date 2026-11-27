
const { Telegraf, Markup } = require("telegraf");
const { supabase, checked } = require("./db");

const required = [
  "BOT_TOKEN",
  "ADMIN_TELEGRAM_ID",
  "CHANNEL_ID",
  "WEBHOOK_SECRET"
];

for (const key of required) {
  if (!process.env[key]?.trim()) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

const adminIdRaw = process.env.ADMIN_TELEGRAM_ID.trim();

if (!/^\d+$/.test(adminIdRaw)) {
  throw new Error("ADMIN_TELEGRAM_ID must contain only numbers");
}

const ADMIN_ID = Number(adminIdRaw);
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!Number.isSafeInteger(ADMIN_ID)) {
  throw new Error("Invalid ADMIN_TELEGRAM_ID");
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================================================
// MAIN MENU
// ==================================================

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📝 ለመመዝገብ", "register")],
    [Markup.button.callback("💳 የክፍያ ሁኔታዬ", "my_payment")]
  ]);

// ==================================================
// STUDENT FUNCTIONS
// ==================================================

async function saveStudent(ctx, extra = {}) {
  const from = ctx.from;

  return checked(
    supabase
      .from("students")
      .upsert(
        {
          telegram_id: from.id,
          username: from.username ?? null,
          first_name: from.first_name ?? null,
          last_name: from.last_name ?? null,
          updated_at: new Date().toISOString(),
          ...extra
        },
        { onConflict: "telegram_id" }
      )
      .select()
      .single()
  );
}

async function getStudent(id) {
  return checked(
    supabase
      .from("students")
      .select("*")
      .eq("telegram_id", id)
      .maybeSingle()
  );
}

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

// ==================================================
// IMPORTANT: CHECK ACTUAL RECEIPT SUBMISSION
// ==================================================

// A student has submitted a receipt ONLY when:
// 1. screenshot_file_id exists and is not empty.
// 2. Payment status is pending or approved.
//
// Selecting a stream, semester, or payment method
// does NOT count as receipt submission.

async function hasSubmittedReceipt(telegramId) {
  const { data, error } = await supabase
    .from("payments")
    .select("id, telegram_id, status, screenshot_file_id")
    .eq("telegram_id", Number(telegramId))
    .in("status", ["pending", "approved"])
    .not("screenshot_file_id", "is", null);

  if (error) {
    console.error("RECEIPT CHECK ERROR:", error);
    throw error;
  }

  const submitted = (data || []).some((payment) => {
    return (
      payment.screenshot_file_id &&
      typeof payment.screenshot_file_id === "string" &&
      payment.screenshot_file_id.trim().length > 0 &&
      ["pending", "approved"].includes(payment.status)
    );
  });

  console.log("RECEIPT CHECK:", {
    telegramId,
    submitted,
    matchingRecords: (data || []).length
  });

  return submitted;
}

async function blockIfReceiptSubmitted(ctx) {
  const submitted = await hasSubmittedReceipt(ctx.from.id);

  if (!submitted) {
    return false;
  }

  await ctx.reply(
    "You have already submitted your receipt. Please wait for the admin's response."
  );

  return true;
}

// ==================================================
// COURSE LIST
// ==================================================

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
    return ctx.reply(
      "በዚህ የትምህርት ዘርፍና ሴሚስተር የተመዘገቡ ኮርሶች የሉም። እባክዎ አድሚን ያነጋግሩ።"
    );
  }

  const list = courses
    .map((course, index) => {
      const cleanName = course.name.replace(
        /^\s*\d+\s*[.)\-:]\s*/,
        ""
      );

      return `${index + 1}. ${cleanName}`;
    })
    .join("\n");

  const streamName =
    stream === "Natural Sc."
      ? "የተፈጥሮ ሳይንስ"
      : "የማህበራዊ ሳይንስ";

  await ctx.reply(
    `📚 ${streamName}\n` +
      `📖 ${semester === "Semester 1" ? "የመጀመሪያ ሴሚስተር" : "ሁለተኛ ሴሚስተር"}\n\n` +
      `የሴሚስተሩ ኮርሶች:\n\n${list}\n\n` +
      "ℹ️ ክፍያው ለሙሉ ሴሚስተር ኮርሶች ነው።\n" +
      "ለመቀጠል ከታች ያለውን ቁልፍ ይጫኑ።",
    Markup.inlineKeyboard([
      [Markup.button.callback("➡️ ወደ ክፍያ ቀጥል", "continue_payment")]
    ])
  );
}

// ==================================================
// PAYMENT INSTRUCTIONS
// ==================================================

async function showPaymentInstructions(ctx, payment, method) {
  const accountName =
    method === "CBE"
      ? process.env.CBE_ACCOUNT_NAME
      : process.env.TELEBIRR_ACCOUNT_NAME;

  const accountNumber =
    method === "CBE"
      ? process.env.CBE_ACCOUNT_NUMBER
      : process.env.TELEBIRR_ACCOUNT_NUMBER;

  const methodName =
    method === "CBE"
      ? "Commercial Bank of Ethiopia"
      : "Telebirr";

  await ctx.reply(
    `💳 የክፍያ መረጃ\n\n` +
      `የክፍያ ዘዴ: ${methodName}\n` +
      `የሂሳብ ባለቤት: ${accountName || "አልተዘጋጀም"}\n` +
      `የሂሳብ ቁጥር: ${accountNumber || "አልተዘጋጀም"}\n` +
      `የሚከፈለው መጠን: ${process.env.PAYMENT_AMOUNT || "አስተዳዳሪውን ይጠይቁ"} ${process.env.CURRENCY || "ETB"}\n\n` +
      `1️⃣ ክፍያውን ይፈጽሙ።\n` +
      `2️⃣ የክፍያ ደረሰኙን Screenshot ያንሱ።\n` +
      `3️⃣ ከታች ያለውን ቁልፍ በመጫን ደረሰኙን ይላኩ።\n\n` +
      `የክፍያ መለያ: ${payment.id}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("📤 ደረሰኝ ለመላክ ይጫኑ", "send_receipt")]
    ])
  );
}

// ==================================================
// START
// ==================================================

bot.start(async (ctx) => {
  await saveStudent(ctx, { state: "start" });

  await ctx.reply(
    `👋 ሰላም ${ctx.from.first_name || "ተማሪ"}!\n\n` +
      "ወደ የወሎ ፈተናዎች  መዳረሻ ቦት በደህና መጡ።\n\n" +
      "ይህ ቦት የሴሚስተር ኮርሶችን እንዲመዘገቡ፣ ክፍያ እንዲፈጽሙ እና ወደ የግል ቻናላችን መግቢያ እንዲያገኙ ይረዳዎታል።\n\n" +
      "ከታች ያለውን ይምረጡ።",
    mainMenu()
  );
});

// ==================================================
// REGISTER
// ==================================================

bot.action("register", async (ctx) => {
  await ctx.answerCbQuery();

  if (await blockIfReceiptSubmitted(ctx)) return;

  await saveStudent(ctx, {
    state: "select_stream",
    stream: null,
    semester: null
  });

  await ctx.reply(
    "📚 እባክዎ የትምህርት ዘርፍዎን ይምረጡ።",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "የተፈጥሮ ሳይንስ",
          "stream:Natural Sc."
        )
      ],
      [
        Markup.button.callback(
          "የማህበራዊ ሳይንስ",
          "stream:Social Sc."
        )
      ]
    ])
  );
});

// ==================================================
// SELECT STREAM
// ==================================================

bot.action(/^stream:(Natural Sc\.|Social Sc\.)$/, async (ctx) => {
  await ctx.answerCbQuery();

  if (await blockIfReceiptSubmitted(ctx)) return;

  const stream = ctx.match[1];

  await setState(ctx.from.id, "select_semester", {
    stream,
    semester: null
  });

  await ctx.reply(
    "📖 እባክዎ ሴሚስተር ይምረጡ።",
    Markup.inlineKeyboard([
      [Markup.button.callback("ሴሚስተር 1", "semester:Semester 1")],
      [Markup.button.callback("ሴሚስተር 2", "semester:Semester 2")]
    ])
  );
});

// ==================================================
// SELECT SEMESTER
// ==================================================

bot.action(/^semester:(Semester [12])$/, async (ctx) => {
  await ctx.answerCbQuery();

  if (await blockIfReceiptSubmitted(ctx)) return;

  const semester = ctx.match[1];
  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream) {
    return ctx.reply(
      "እባክዎ /start በመጫን ምዝገባውን እንደገና ይጀምሩ።"
    );
  }

  await setState(ctx.from.id, "review_courses", { semester });

  await replyCourses(ctx, student.stream, semester);
});

// ==================================================
// CONTINUE PAYMENT
// ==================================================

bot.action("continue_payment", async (ctx) => {
  await ctx.answerCbQuery();

  if (await blockIfReceiptSubmitted(ctx)) return;

  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream || !student.semester) {
    return ctx.reply(
      "ምዝገባዎ አልተጠናቀቀም። እባክዎ /start ይጫኑ።"
    );
  }

  await setState(ctx.from.id, "select_payment");

  await ctx.reply(
    "💳 እባክዎ የክፍያ ዘዴዎን ይምረጡ።",
    Markup.inlineKeyboard([
      [Markup.button.callback("🏦 CBE", "payment:CBE")],
      [Markup.button.callback("📱 Telebirr", "payment:TELEBIRR")]
    ])
  );
});

// ==================================================
// SELECT PAYMENT METHOD
// ==================================================

bot.action(/^payment:(CBE|TELEBIRR)$/, async (ctx) => {
  await ctx.answerCbQuery();

  if (await blockIfReceiptSubmitted(ctx)) return;

  const method = ctx.match[1];
  const student = await getStudent(ctx.from.id);

  if (!student || !student.stream || !student.semester) {
    return ctx.reply(
      "ምዝገባዎ አልተጠናቀቀም። እባክዎ /startን ይጫኑ።"
    );
  }

  // IMPORTANT:
  // An awaiting_screenshot row means the student has NOT
  // submitted a receipt. Reuse it instead of blocking them.

  const previous = await checked(
    supabase
      .from("payments")
      .select("*")
      .eq("telegram_id", ctx.from.id)
      .eq("status", "awaiting_screenshot")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  let payment;

  if (previous.length > 0) {
    payment = await checked(
      supabase
        .from("payments")
        .update({
          stream: student.stream,
          semester: student.semester,
          payment_method: method,
          amount: process.env.PAYMENT_AMOUNT
            ? Number(process.env.PAYMENT_AMOUNT)
            : null
        })
        .eq("id", previous[0].id)
        .eq("status", "awaiting_screenshot")
        .select()
        .single()
    );
  } else {
    payment = await checked(
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
          status: "awaiting_screenshot",
          screenshot_file_id: null
        })
        .select()
        .single()
    );
  }

  await setState(ctx.from.id, "awaiting_screenshot");

  await showPaymentInstructions(ctx, payment, method);
});

// ==================================================
// SEND RECEIPT BUTTON
// ==================================================

bot.action("send_receipt", async (ctx) => {
  await ctx.answerCbQuery();

  const rows = await checked(
    supabase
      .from("payments")
      .select("id")
      .eq("telegram_id", ctx.from.id)
      .eq("status", "awaiting_screenshot")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  if (!rows.length) {
    return ctx.reply(
      "የሚጠባበቅ የክፍያ ጥያቄ አልተገኘም። እባክዎ የክፍያ ዘዴዎን እንደገና ይምረጡ።"
    );
  }

  await ctx.reply(
    "📸 እባክዎ የክፍያ ደረሰኝዎን  ፎቶ ይላኩ።\n\n" +
      "ደረሰኙ ግልጽ እና ሙሉ መረጃው የሚታይበት መሆን አለበት።"
  );
});

// ==================================================
// MY PAYMENT
// ==================================================

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
    return ctx.reply("እስካሁን የክፍያ ጥያቄ አላቀረቡም።");
  }

  const p = rows[0];

  const statusText = {
    awaiting_screenshot: "ደረሰኝ እየተጠበቀ ነው",
    pending: "ለማረጋገጫ ተልኳል",
    approved: "ተፈቅዷል",
    rejected: "አልተፈቀደም"
  };

  await ctx.reply(
    `💳 የመጨረሻ የክፍያ ሁኔታ\n\n` +
      `የትምህርት ዘርፍ: ${p.stream}\n` +
      `ሴሚስተር: ${p.semester}\n` +
      `የክፍያ ዘዴ: ${p.payment_method}\n` +
      `ሁኔታ: ${statusText[p.status] || p.status}`
  );
});

// ==================================================
// RECEIVE PHOTO
// ==================================================

bot.on("photo", async (ctx) => {
  try {
    const student = await getStudent(ctx.from.id);

    if (!student) {
      return ctx.reply("እባክዎ መጀመሪያ /start ይጫኑ።");
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
        "ደረሰኝ የሚጠብቅ የክፍያ ጥያቄ አልተገኘም። እባክዎ የክፍያ ዘዴዎን መጀመሪያ ይምረጡ።"
      );
    }

    const payment = rows[0];
    const photo = ctx.message.photo[ctx.message.photo.length - 1];

    // First, send the photo to the admin.
    // Do not mark it pending until the admin receives it.

    const username = ctx.from.username
      ? `@${ctx.from.username}`
      : "የተጠቃሚ ስም የለም";

    const caption =
      `🧾 አዲስ የክፍያ ደረሰኝ\n\n` +
      `ተማሪ: ${ctx.from.first_name || ""} ${ctx.from.last_name || ""}\n` +
      `Username: ${username}\n` +
      `Telegram ID: ${ctx.from.id}\n` +
      `የትምህርት ዘርፍ: ${payment.stream}\n` +
      `ሴሚስተር: ${payment.semester}\n` +
      `የክፍያ ዘዴ: ${payment.payment_method}\n` +
      `የክፍያ መለያ: ${payment.id}\n\n` +
      `እባክዎ ደረሰኙን ያረጋግጡ።`;

    try {
      await ctx.telegram.sendPhoto(ADMIN_ID, photo.file_id, {
        caption,
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ አጽድቅ", `approve:${payment.id}`),
            Markup.button.callback("❌ ውድቅ አድርግ", `reject:${payment.id}`)
          ]
        ]).reply_markup
      });
    } catch (error) {
      console.error("ADMIN RECEIPT DELIVERY ERROR:", error);

      return ctx.reply(
        "⚠️ ደረሰኙን ለአስተዳዳሪው መላክ አልተቻለም።\n\n" +
          "እባክዎ ቆይተው እንደገና ይሞክሩ ወይም አስተዳዳሪውን ያነጋግሩ።"
      );
    }

    // Only now save the actual Telegram photo file ID.
    // This is the ONLY place that marks a payment pending.

    await checked(
      supabase
        .from("payments")
        .update({
          screenshot_file_id: photo.file_id,
          status: "pending"
        })
        .eq("id", payment.id)
        .eq("telegram_id", ctx.from.id)
        .eq("status", "awaiting_screenshot")
    );

    await ctx.reply(
      "የክፍያ ደረሰኝዎ ለአስተዳዳሪው ተልኳል።\n" +
        "አስተዳዳሪው በ2–3 ሰዓታት ውስጥ ያረጋግጠዋል።\n\n" +
        "ከተፈቀደ በኋላ የቻናሉን መግቢያ በዚህ ቦት ይቀበላሉ።"
    );
  } catch (error) {
    console.error("RECEIPT HANDLER ERROR:", error);

    return ctx.reply(
      "⚠️ ስህተት ተፈጥሯል። እባክዎ ቆይተው እንደገና ይሞክሩ።"
    );
  }
});

// ==================================================
// ADMIN APPROVE
// ==================================================

bot.action(/^approve:([0-9a-f-]{36})$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም።", {
      show_alert: true
    });
    return;
  }

  await ctx.answerCbQuery("እየተረጋገጠ ነው...");

  const paymentId = ctx.match[1];

  const rows = await checked(
    supabase
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .eq("status", "pending")
      .not("screenshot_file_id", "is", null)
      .limit(1)
  );

  if (!rows.length || !rows[0].screenshot_file_id) {
    return ctx.reply("ይህ ክፍያ አስቀድሞ ተመርምሯል ወይም አልተገኘም።");
  }

  const payment = rows[0];
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  const invite = await ctx.telegram.createChatInviteLink(CHANNEL_ID, {
    expire_date: expiresAt,
    member_limit: 1,
    name: `payment-${payment.id.slice(0, 8)}`
  });

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
        expires_at: new Date(expiresAt * 1000).toISOString()
      })
  );

  await ctx.telegram.sendMessage(
    payment.telegram_id,
    `🎉 ክፍያዎ በተሳካ ሁኔታ ተጠናቋል!\n\n` +
      `ወደ የግል ቻናላችን ለመግባት ይህንን ሊንክ ይጫኑ:\n` +
      `${invite.invite_link}\n\n` +
      `⚠️ ይህ ሊንክ ለአንድ ሰው ብቻ ነው። በ24 ሰዓታት ውስጥ ያበቃል። ለሌላ ሰው አያጋሩት።`
  );

  await ctx.editMessageCaption(
    `${ctx.callbackQuery.message.caption}\n\n✅ ክፍያው በአስተዳዳሪ ተቀባይነት አግኝቷል።።`
  );
});

// ==================================================
// ADMIN REJECT
// ==================================================

bot.action(/^reject:([0-9a-f-]{36})$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም።", {
      show_alert: true
    });
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
      .not("screenshot_file_id", "is", null)
      .limit(1)
  );

  if (!rows.length || !rows[0].screenshot_file_id) {
    return ctx.reply("ይህ ክፍያ አስቀድሞ ተመርምሯል ወይም አልተገኘም።");
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
    "❌ የክፍያ ደረሰኝዎ ተቀባይነት አላገኘኘም።\n\n" +
      "እባክዎ ደረሰኙን ይመልከቱ እና ለበለጠ መረጃ አስተዳዳሪውን ያነጋግሩ።"
  );

  await ctx.editMessageCaption(
    `${ctx.callbackQuery.message.caption}\n\n❌ ክፍያው ውድቅ ተደርጓል።`
  );
});

// ==================================================
// ERROR HANDLING
// ==================================================

bot.catch((err) => {
  console.error("Bot handler error:", err);
});

module.exports = { bot };
