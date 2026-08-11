const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const DATA_FILE = path.join(__dirname, "data", "db.json");

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

const FAIR_DATES = [
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12"
];

const TIMES = [];
for (let h = 10; h < 18; h++) {
  TIMES.push(`${String(h).padStart(2, "0")}:00`);
  TIMES.push(`${String(h).padStart(2, "0")}:30`);
}

const HOLD_MS = 5 * 60 * 1000;
const holds = new Map();
const adminSessions = new Map();

app.use(express.json({ limit: "250kb" }));
app.use(express.static(path.join(__dirname, "public")));

function ensureDb() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ bookings: [] }, null, 2));
  }
}
function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function writeDb(db) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function validSlot(date, time) {
  return FAIR_DATES.includes(date) && TIMES.includes(time);
}
function slotKey(date, time) {
  return `${date}|${time}`;
}
function cleanExpiredHolds() {
  const now = Date.now();
  for (const [key, hold] of holds.entries()) {
    if (hold.expiresAt <= now) holds.delete(key);
  }
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
function isAdmin(req) {
  const token = getCookie(req, "kraw_admin");
  const session = token && adminSessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Yetkisiz erişim." });
  next();
}
function publicBooking(b) {
  return { id: b.id, date: b.date, time: b.time, status: "booked" };
}
function sanitizeText(v, max = 200) {
  return String(v || "").trim().slice(0, max);
}
function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}
function formatDateTR(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin"
  }).format(new Date(`${date}T12:00:00`));
}
function endTime(time) {
  let [h, m] = time.split(":").map(Number);
  m += 30;
  if (m >= 60) { h += 1; m -= 60; }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
async function sendBookingConfirmation(booking) {
  if (!transporter) return { sent: false, skipped: true, reason: "SMTP yapılandırılmadı." };

  const dateText = formatDateTR(booking.date);
  const timeText = `${booking.time} - ${endTime(booking.time)}`;

  await transporter.sendMail({
    from: SMTP_FROM,
    to: booking.email,
    subject: "KRAW | Automechanika Frankfurt 2026 Randevu Onayı",
    text: [
      `Sayın ${booking.name},`,
      "",
      "Randevunuz başarıyla oluşturuldu.",
      `Firma: ${booking.company}`,
      `Tarih: ${dateText}`,
      `Saat: ${timeText}`,
      "Etkinlik: Automechanika Frankfurt 2026",
      "Marka: KRAW",
      "",
      "Görüşmek üzere."
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#101418;line-height:1.6">
        <h2 style="margin:0 0 12px">KRAW Randevu Onayı</h2>
        <p>Sayın <b>${booking.name}</b>, randevunuz başarıyla oluşturuldu.</p>
        <table cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr><td><b>Firma</b></td><td>${booking.company}</td></tr>
          <tr><td><b>Tarih</b></td><td>${dateText}</td></tr>
          <tr><td><b>Saat</b></td><td>${timeText}</td></tr>
          <tr><td><b>Etkinlik</b></td><td>Automechanika Frankfurt 2026</td></tr>
          <tr><td><b>Marka</b></td><td>KRAW</td></tr>
        </table>
        <p style="margin-top:18px">Görüşmek üzere.</p>
      </div>
    `
  });

  return { sent: true };
}

app.get("/api/config", (req, res) => {
  res.json({
    brand: "KRAW",
    company: "Karaca Otomotiv Güvenlik",
    event: "Automechanika Frankfurt 2026",
    dates: FAIR_DATES,
    times: TIMES,
    holdMinutes: HOLD_MS / 60000
  });
});

app.get("/api/slots", (req, res) => {
  cleanExpiredHolds();
  const db = readDb();
  const ownToken = req.headers["x-hold-token"] || "";
  const bookings = db.bookings.map(publicBooking);
  const held = [];
  for (const [key, h] of holds.entries()) {
    const [date, time] = key.split("|");
    held.push({
      date, time,
      status: "held",
      mine: h.token === ownToken,
      expiresAt: h.expiresAt
    });
  }
  res.json({ bookings, holds: held });
});

app.post("/api/holds", (req, res) => {
  cleanExpiredHolds();
  const { date, time } = req.body || {};
  if (!validSlot(date, time)) return res.status(400).json({ error: "Geçersiz randevu saati." });

  const db = readDb();
  if (db.bookings.some(b => b.date === date && b.time === time)) {
    return res.status(409).json({ error: "Bu saat az önce rezerve edildi." });
  }

  const key = slotKey(date, time);
  const existing = holds.get(key);
  const suppliedToken = req.headers["x-hold-token"] || "";
  if (existing && existing.token !== suppliedToken) {
    return res.status(409).json({ error: "Bu saat başka bir ziyaretçi tarafından seçildi." });
  }

  const token = existing?.token || crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + HOLD_MS;
  holds.set(key, { token, expiresAt });
  res.json({ token, expiresAt });
});

app.delete("/api/holds", (req, res) => {
  cleanExpiredHolds();
  const { date, time } = req.body || {};
  const key = slotKey(date, time);
  const h = holds.get(key);
  const token = req.headers["x-hold-token"] || "";
  if (h && h.token === token) holds.delete(key);
  res.json({ ok: true });
});

app.post("/api/bookings", async (req, res) => {
  cleanExpiredHolds();
  const { date, time, name, company, email, phone } = req.body || {};
  if (!validSlot(date, time)) return res.status(400).json({ error: "Geçersiz randevu saati." });

  const cleanName = sanitizeText(name, 100);
  const cleanCompany = sanitizeText(company, 120);
  const cleanEmail = sanitizeText(email, 160);
  const cleanPhone = sanitizeText(phone, 60);

  if (!cleanName || !cleanCompany || !cleanEmail || !cleanPhone) {
    return res.status(400).json({ error: "Ad, firma, e-posta ve telefon zorunludur." });
  }
  if (!validEmail(cleanEmail)) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi giriniz." });
  }

  const key = slotKey(date, time);
  const h = holds.get(key);
  const token = req.headers["x-hold-token"] || "";
  if (!h || h.token !== token) {
    return res.status(409).json({ error: "Randevu seçiminizin süresi doldu. Lütfen saati yeniden seçin." });
  }

  const db = readDb();
  if (db.bookings.some(b => b.date === date && b.time === time)) {
    holds.delete(key);
    return res.status(409).json({ error: "Bu saat dolu." });
  }

  const booking = {
    id: crypto.randomUUID(),
    date, time,
    name: cleanName,
    company: cleanCompany,
    email: cleanEmail,
    phone: cleanPhone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.bookings.push(booking);
  writeDb(db);
  holds.delete(key);

  let emailSent = false;
  try {
    const emailResult = await sendBookingConfirmation(booking);
    emailSent = !!emailResult.sent;
  } catch (err) {
    console.error("Onay e-postası gönderilemedi:", err.message);
  }

  res.status(201).json({ ok: true, booking, emailSent });
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(503).json({ error: "Admin girisi sunucu ortam degiskenleriyle yapilandirilmamis." });
  }
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, { expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  res.setHeader("Set-Cookie", `kraw_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const token = getCookie(req, "kraw_admin");
  if (token) adminSessions.delete(token);
  res.setHeader("Set-Cookie", "kraw_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ authenticated: isAdmin(req) });
});

app.get("/api/admin/bookings", requireAdmin, (req, res) => {
  const db = readDb();
  res.json({ bookings: db.bookings.sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)) });
});

app.post("/api/admin/bookings", requireAdmin, (req, res) => {
  cleanExpiredHolds();
  const { date, time, name, company, email, phone } = req.body || {};
  if (!validSlot(date, time)) return res.status(400).json({ error: "Geçersiz slot." });

  const cleanName = sanitizeText(name, 100);
  const cleanCompany = sanitizeText(company, 120);
  const cleanEmail = sanitizeText(email, 160);
  const cleanPhone = sanitizeText(phone, 60);

  if (!cleanName || !cleanCompany || !cleanEmail || !cleanPhone) {
    return res.status(400).json({ error: "Tüm alanlar zorunludur." });
  }
  if (!validEmail(cleanEmail)) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi giriniz." });
  }

  const db = readDb();
  if (db.bookings.some(b => b.date === date && b.time === time)) {
    return res.status(409).json({ error: "Bu slot zaten dolu." });
  }

  holds.delete(slotKey(date, time));
  const booking = {
    id: crypto.randomUUID(),
    date, time,
    name: cleanName,
    company: cleanCompany,
    email: cleanEmail,
    phone: cleanPhone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.bookings.push(booking);
  writeDb(db);
  res.status(201).json({ ok: true, booking });
});

app.put("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const db = readDb();
  const idx = db.bookings.findIndex(b => b.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Kayıt bulunamadı." });

  const old = db.bookings[idx];
  const next = { ...old, ...req.body, id: old.id };

  const cleanName = sanitizeText(next.name, 100);
  const cleanCompany = sanitizeText(next.company, 120);
  const cleanEmail = sanitizeText(next.email, 160);
  const cleanPhone = sanitizeText(next.phone, 60);

  if (!validSlot(next.date, next.time)) return res.status(400).json({ error: "Geçersiz slot." });
  if (!cleanName || !cleanCompany || !cleanEmail || !cleanPhone) {
    return res.status(400).json({ error: "Tüm alanlar zorunludur." });
  }
  if (!validEmail(cleanEmail)) {
    return res.status(400).json({ error: "Geçerli bir e-posta adresi giriniz." });
  }
  if (db.bookings.some(b => b.id !== old.id && b.date === next.date && b.time === next.time)) {
    return res.status(409).json({ error: "Hedef slot dolu." });
  }

  next.name = cleanName;
  next.company = cleanCompany;
  next.email = cleanEmail;
  next.phone = cleanPhone;
  next.updatedAt = new Date().toISOString();

  db.bookings[idx] = next;
  writeDb(db);
  res.json({ ok: true, booking: next });
});

app.delete("/api/admin/bookings/:id", requireAdmin, (req, res) => {
  const db = readDb();
  const before = db.bookings.length;
  db.bookings = db.bookings.filter(b => b.id !== req.params.id);
  if (db.bookings.length === before) return res.status(404).json({ error: "Kayıt bulunamadı." });
  writeDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  ensureDb();
  console.log(`KRAW rezervasyon sistemi: http://localhost:${PORT}`);
  if (!transporter) {
    console.log("SMTP ayarları tanımlı değil. Onay e-postaları gönderilmeyecek.");
  }
});
