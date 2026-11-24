const { Telegraf, Markup, session } = require('telegraf');
const Database = require('better-sqlite3');

const {
  BOT_TOKEN,
  ADMIN_IDS = '',
  TELEBIRR_NUMBER,
  TELEBIRR_NAME,
  CBE_ACCOUNT,
  CBE_NAME,
} = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is missing in .env');

const admins = ADMIN_IDS.split(',').map((s) => Number(s.trim())).filter(Boolean);
const isAdmin = (id) => admins.includes(id);

// ---------- Display helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Short stream names typed as "ns" / "Ss" are stored as NS / SS so they always match.
const normStream = (s) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return /^[a-z]{2,3}$/i.test(t) ? t.toUpperCase() : t;
};
const STREAMS = {
  NS: { icon: '🧪', label: 'Natural Science (NS)' },
  SS: { icon: '📖', label: 'Social Science (SS)' },
};
const streamInfo = (s) => STREAMS[String(s).toUpperCase()] || { icon: '🎓', label: s };
const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const numIcon = (i) => NUM[i] || `${i + 1}.`;
const LINE = '━━━━━━━━━━━━━━━━━━';

// ---------- Database ----------
// One package = one semester + stream, with ONE price and ONE channel.
// The course names are just a list shown to the student before the price.
const db = new Database('bot.db');
db.exec(`
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester TEXT NOT NULL,
  stream TEXT NOT NULL,
  price REAL NOT NULL,
  channel_id TEXT NOT NULL,
  UNIQUE (semester, stream)
);
CREATE TABLE IF NOT EXISTS course_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester TEXT NOT NULL,
  stream TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  package_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | used
  invite_link TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const q = {
  semesters: db.prepare('SELECT DISTINCT semester FROM packages ORDER BY semester'),
  packagesIn: db.prepare('SELECT * FROM packages WHERE semester = ? ORDER BY stream'),
  pkg: db.prepare('SELECT * FROM packages WHERE id = ?'),
  allPkgs: db.prepare('SELECT * FROM packages ORDER BY semester, stream'),
  upsertPkg: db.prepare(`
    INSERT INTO packages (semester, stream, price, channel_id) VALUES (?,?,?,?)
    ON CONFLICT (semester, stream) DO UPDATE SET price = excluded.price, channel_id = excluded.channel_id`),
  delPkg: db.prepare('DELETE FROM packages WHERE id = ?'),
  coursesOf: db.prepare('SELECT * FROM course_list WHERE semester = ? AND stream = ? COLLATE NOCASE ORDER BY id'),
  orphans: db.prepare(`SELECT DISTINCT semester, stream FROM course_list c
    WHERE NOT EXISTS (SELECT 1 FROM packages p WHERE p.semester = c.semester AND p.stream = c.stream COLLATE NOCASE)`),
  addCourse: db.prepare('INSERT INTO course_list (semester, stream, name) VALUES (?,?,?)'),
  delCourse: db.prepare('DELETE FROM course_list WHERE id = ?'),
  delCoursesOf: db.prepare('DELETE FROM course_list WHERE semester = ? AND stream = ? COLLATE NOCASE'),
  addOrder: db.prepare('INSERT INTO orders (user_id, username, package_id, file_id, file_type) VALUES (?,?,?,?,?)'),
  order: db.prepare('SELECT * FROM orders WHERE id = ?'),
  setStatus: db.prepare('UPDATE orders SET status = ?, invite_link = COALESCE(?, invite_link) WHERE id = ?'),
  byLink: db.prepare('SELECT * FROM orders WHERE invite_link = ?'),
};

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

async function showStart(ctx) {
  ctx.session = {};
  const rows = q.semesters.all();
  if (!rows.length) return ctx.reply('No courses are available yet. Please check back later.');
  const kb = Markup.inlineKeyboard(rows.map((r) => [Markup.button.callback(`📅 Semester ${r.semester}`, `sem:${r.semester}`)]));
  const text = '👋 Welcome!\n\nStep 1: choose your semester.';
  if (ctx.callbackQuery) return ctx.editMessageText(text, kb).catch(() => ctx.reply(text, kb));
  return ctx.reply(text, kb);
}

bot.start(showStart);
bot.action('home', async (ctx) => { await ctx.answerCbQuery(); return showStart(ctx); });

// Semester -> streams
bot.action(/^sem:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const sem = ctx.match[1];
  const pkgs = q.packagesIn.all(sem);
  const kb = pkgs.map((p) => {
    const s = streamInfo(p.stream);
    return [Markup.button.callback(`${s.icon} ${s.label}`, `pkg:${p.id}`)];
  });
  kb.push([Markup.button.callback('⬅️ Back', 'home')]);
  return ctx.editMessageText(`Semester ${sem}\n\nStep 2: choose your stream.`, Markup.inlineKeyboard(kb));
});

// Stream -> course list, then price and payment at the end
bot.action(/^pkg:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const pkg = q.pkg.get(Number(ctx.match[1]));
  if (!pkg) return ctx.reply('This option is no longer available.');
  const courses = q.coursesOf.all(pkg.semester, pkg.stream);
  const s = streamInfo(pkg.stream);
  const list = courses.length
    ? courses.map((c, i) => `${numIcon(i)} ${esc(c.name)}`).join('\n')
    : '<i>Courses will be added soon</i>';
  const text =
    `${LINE}\n${s.icon} <b>${esc(s.label)}</b>\n📅 Semester ${esc(pkg.semester)}\n${LINE}\n\n` +
    `📚 <b>Courses included</b>\n${list}\n\n` +
    `${LINE}\n💰 <b>Total price: ${pkg.price} ETB</b>\n${LINE}\n\n` +
    `💳 <b>Choose your payment method:</b>`;
  return ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('📱 Telebirr', `pay:${pkg.id}:tb`),
        Markup.button.callback('🏦 CBE', `pay:${pkg.id}:cbe`),
      ],
      [Markup.button.callback('⬅️ Back', `sem:${pkg.semester}`)],
    ]),
  });
});

// Payment method -> account details
const METHODS = {
  tb: () => ({ name: 'Telebirr', icon: '📱', numLabel: 'Number', number: TELEBIRR_NUMBER, holder: TELEBIRR_NAME }),
  cbe: () => ({ name: 'CBE (Commercial Bank of Ethiopia)', icon: '🏦', numLabel: 'Account', number: CBE_ACCOUNT, holder: CBE_NAME }),
};

bot.action(/^pay:(\d+):(tb|cbe)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const pkg = q.pkg.get(Number(ctx.match[1]));
  if (!pkg) return ctx.reply('This option is no longer available.');
  const key = ctx.match[2];
  const m = METHODS[key]();
  const s = streamInfo(pkg.stream);
  const text =
    `${m.icon} <b>Pay with ${esc(m.name)}</b>\n\n` +
    `${s.icon} ${esc(s.label)} · Semester ${esc(pkg.semester)}\n` +
    `💰 Amount: <b>${pkg.price} ETB</b>\n\n` +
    `${m.numLabel}: <code>${esc(m.number)}</code>\n` +
    `Name: ${esc(m.holder)}\n\n` +
    `After paying, tap <b>Submit receipt</b> and send a screenshot.`;
  return ctx.editMessageText(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📤 Submit receipt', `submit:${pkg.id}:${key}`)],
      [
        Markup.button.callback('🔄 Change method', `pkg:${pkg.id}`),
        Markup.button.callback('⬅️ Back', `sem:${pkg.semester}`),
      ],
    ]),
  });
});

// Waiting for receipt
bot.action(/^submit:(\d+):(tb|cbe)$/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.awaitingPackage = Number(ctx.match[1]);
  ctx.session.awaitingMethod = ctx.match[2];
  return ctx.reply('📸 Please send your payment receipt now (as a photo or file).');
});

async function handleReceipt(ctx, fileId, fileType) {
  const pkgId = ctx.session.awaitingPackage;
  if (!pkgId) return ctx.reply('Please use /start and choose your semester and stream first.');
  const pkg = q.pkg.get(pkgId);
  if (!pkg) return ctx.reply('This option is no longer available.');

  const u = ctx.from;
  const { lastInsertRowid } = q.addOrder.run(u.id, u.username || null, pkgId, fileId, fileType);
  const oid = Number(lastInsertRowid);
  const method = METHODS[ctx.session.awaitingMethod];
  const methodName = method ? method().name : 'Not specified';
  ctx.session.awaitingPackage = null;
  ctx.session.awaitingMethod = null;

  const caption =
    `🧾 New payment #${oid}\n` +
    `User: ${u.first_name || ''} ${u.last_name || ''} ${u.username ? '@' + u.username : ''}\n` +
    `User ID: ${u.id}\n` +
    `Package: Semester ${pkg.semester} · ${pkg.stream}\n` +
    `Amount: ${pkg.price} ETB\n` +
    `Paid via: ${methodName}`;
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Approve', `ap:${oid}`), Markup.button.callback('❌ Reject', `rj:${oid}`)],
  ]);

  for (const adminId of admins) {
    try {
      if (fileType === 'photo') await bot.telegram.sendPhoto(adminId, fileId, { caption, ...kb });
      else await bot.telegram.sendDocument(adminId, fileId, { caption, ...kb });
    } catch (e) {
      console.error('Could not notify admin', adminId, e.message);
    }
  }
  return ctx.reply('✅ Receipt received. Your payment is pending and will be answered within 1–3 hours. Please wait while the admin verifies it.');
}

bot.on('photo', (ctx) => {
  const photos = ctx.message.photo;
  return handleReceipt(ctx, photos[photos.length - 1].file_id, 'photo');
});
bot.on('document', (ctx) => handleReceipt(ctx, ctx.message.document.file_id, 'document'));

// ---------- Admin approve / reject ----------
async function markAdminMessage(ctx, label) {
  const old = ctx.callbackQuery.message.caption || '';
  await ctx.editMessageCaption(`${old}\n\n${label}`).catch(() => {});
}

bot.action(/^ap:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Not allowed', { show_alert: true });
  const order = q.order.get(Number(ctx.match[1]));
  if (!order) return ctx.answerCbQuery('Payment not found');
  if (order.status !== 'pending') return ctx.answerCbQuery(`Already ${order.status}`);
  const pkg = q.pkg.get(order.package_id);

  try {
    // Join-request link: nobody enters without the bot checking who they are.
    const link = await ctx.telegram.createChatInviteLink(pkg.channel_id, {
      name: `pay-${order.id}`,
      creates_join_request: true,
      expire_date: Math.floor(Date.now() / 1000) + 24 * 3600,
    });
    q.setStatus.run('approved', link.invite_link, order.id);
    await ctx.telegram.sendMessage(
      order.user_id,
      `🎉 Payment approved!\n\nJoin your Semester ${pkg.semester} · ${pkg.stream} channel here (valid for 24 hours, works for you only):\n${link.invite_link}`
    );
    await ctx.answerCbQuery('Approved');
    await markAdminMessage(ctx, `✅ Approved by ${ctx.from.first_name}`);
  } catch (e) {
    console.error(e);
    await ctx.answerCbQuery('Failed: make the bot an admin of the channel', { show_alert: true });
  }
});

bot.action(/^rj:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Not allowed', { show_alert: true });
  const order = q.order.get(Number(ctx.match[1]));
  if (!order) return ctx.answerCbQuery('Payment not found');
  if (order.status !== 'pending') return ctx.answerCbQuery(`Already ${order.status}`);
  q.setStatus.run('rejected', null, order.id);
  await ctx.telegram.sendMessage(order.user_id, '❌ Your payment could not be verified. Please check the receipt and try again with /start.').catch(() => {});
  await ctx.answerCbQuery('Rejected');
  await markAdminMessage(ctx, `❌ Rejected by ${ctx.from.first_name}`);
});

// ---------- Single-user enforcement ----------
// Only the paying user can get in, and only once. Anyone else is declined.
bot.on('chat_join_request', async (ctx) => {
  const req = ctx.chatJoinRequest;
  const linkUrl = req.invite_link && req.invite_link.invite_link;
  const order = linkUrl ? q.byLink.get(linkUrl) : null;
  try {
    if (order && order.status === 'approved' && order.user_id === req.from.id) {
      await ctx.telegram.approveChatJoinRequest(req.chat.id, req.from.id);
      q.setStatus.run('used', null, order.id);
      await ctx.telegram.revokeChatInviteLink(req.chat.id, linkUrl).catch(() => {});
    } else if (order) {
      await ctx.telegram.declineChatJoinRequest(req.chat.id, req.from.id);
    }
  } catch (e) {
    console.error('join request error', e.message);
  }
});

// ---------- Admin commands ----------
const argsOf = (ctx, cmd) =>
  ctx.message.text.replace(new RegExp(`^/${cmd}(@\\w+)?\\s*`), '').split('|').map((s) => s.trim());

// /addcourse Semester | Stream | Course 1, Course 2, Course 3
bot.command('addcourse', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const a = argsOf(ctx, 'addcourse');
  if (a.length !== 3 || a.some((x) => !x)) {
    return ctx.reply(
      'Usage:\n/addcourse Semester | Stream | Course 1, Course 2, Course 3\n\n' +
      'Example:\n/addcourse 1 | Software | Data Structures, Databases, Networking'
    );
  }
  const [sem, rawStream, names] = a;
  const stream = normStream(rawStream);
  const list = names.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of list) q.addCourse.run(sem, stream, n);
  return ctx.reply(`✅ Added ${list.length} course(s) to Semester ${sem} · ${stream}.\n\nNow set the price and channel:\n/setprice ${sem} | ${stream} | 500 | -1001234567890`);
});

// /setprice Semester | Stream | Price | Channel ID   (one price for the whole list)
bot.command('setprice', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const a = argsOf(ctx, 'setprice');
  if (a.length !== 4 || a.some((x) => !x) || Number.isNaN(Number(a[2]))) {
    return ctx.reply(
      'Usage:\n/setprice Semester | Stream | Price | Channel ID\n\n' +
      'Example:\n/setprice 1 | Software | 500 | -1001234567890'
    );
  }
  const [sem, rawStream, price, channel] = a;
  const stream = normStream(rawStream);
  q.upsertPkg.run(sem, stream, Number(price), channel);
  return ctx.reply(`✅ Semester ${sem} · ${stream}: ${price} ETB. Students can now see and buy it.`);
});

bot.command('courses', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const pkgs = q.allPkgs.all();
  const orphans = q.orphans.all();
  if (!pkgs.length && !orphans.length) return ctx.reply('Nothing set up yet. Use /addcourse then /setprice.');
  const fmt = (sem, stream) =>
    q.coursesOf.all(sem, stream).map((c) => `   #${c.id} ${c.name}`).join('\n') || '   (no courses)';
  const out = pkgs.map((p) =>
    `📦 #${p.id} Sem ${p.semester} · ${p.stream} · ${p.price} ETB · ${p.channel_id}\n${fmt(p.semester, p.stream)}`
  );
  for (const o of orphans) {
    out.push(
      `⚠️ Sem ${o.semester} · ${o.stream} has courses but NO price, so students cannot see it.\n` +
      `Fix: /setprice ${o.semester} | ${o.stream} | <price> | <channel id>\n${fmt(o.semester, o.stream)}`
    );
  }
  return ctx.reply(out.join('\n\n'));
});

// /delcourse 3 4 5   (or 3,4,5)   removes one or more course names from their lists
bot.command('delcourse', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const ids = ctx.message.text
    .replace(/^\/delcourse(@\w+)?\s*/, '')
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return ctx.reply('Usage: /delcourse <id> [id id ...]\nExample: /delcourse 3 4 5\n\n(ids are shown by /courses)');
  let deleted = 0;
  for (const id of ids) deleted += q.delCourse.run(id).changes;
  return ctx.reply(`🗑 Deleted ${deleted} course(s).` + (deleted < ids.length ? `\n${ids.length - deleted} id(s) were not found.` : ''));
});

// /delpackage <package id>   removes a whole semester+stream with its courses
bot.command('delpackage', (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  const pkg = id && q.pkg.get(id);
  if (!pkg) return ctx.reply('Usage: /delpackage <package id>  (ids are shown by /courses)');
  q.delCoursesOf.run(pkg.semester, pkg.stream);
  q.delPkg.run(id);
  return ctx.reply(`🗑 Deleted Semester ${pkg.semester} · ${pkg.stream}`);
});

bot.catch((err) => console.error('Bot error:', err));

bot.launch({ allowedUpdates: ['message', 'callback_query', 'chat_join_request'] });
console.log('Bot is running…');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));