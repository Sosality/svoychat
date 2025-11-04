// server.js
import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";

// 👇 Подключаем базу данных (db.js автоматически выполнится)
import "./db.js";
import { pool } from "./db.js";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 10000;

/* =============================
   🔐 Функции шифрования ключей
============================= */

function encryptPrivateKey(privKey, password) {
  return CryptoJS.AES.encrypt(
    privKey,
    process.env.SECRET_KEY + password
  ).toString();
}

function decryptPrivateKey(ciphertext, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(
      ciphertext,
      process.env.SECRET_KEY + password
    );
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    console.error("❌ Ошибка расшифровки:", err);
    return null;
  }
}

/* =============================
   👤 Регистрация нового пользователя
============================= */
app.post("/api/register", async (req, res) => {
  const { username, password, pubKey, privKey } = req.body;
  if (!username || !password || !pubKey || !privKey)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const privEnc = encryptPrivateKey(privKey, password);

    await pool.query(
      `INSERT INTO users (username, password_hash, pub_key, priv_key_enc)
       VALUES ($1, $2, $3, $4)`,
      [username.toLowerCase(), passwordHash, pubKey, privEnc]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Register error:", err);
    if (err.code === "23505")
      return res.status(409).json({ error: "Username already exists" });
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =============================
   🔑 Авторизация пользователя
============================= */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing username or password" });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username=$1",
      [username.toLowerCase()]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(403).json({ error: "Invalid password" });

    const privDecrypted = decryptPrivateKey(user.priv_key_enc, password);

    res.json({
      ok: true,
      username: user.username,
      pubKey: user.pub_key,
      privKey: privDecrypted, // ⚠️ Убирай, если хочешь хранить приватный ключ только на клиенте
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =============================
   🔍 Получить публичный ключ по тегу
============================= */
app.get("/api/keys/:username", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT pub_key FROM users WHERE username=$1",
      [req.params.username.toLowerCase()]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    res.json({ username: req.params.username, pubKey: rows[0].pub_key });
  } catch (err) {
    console.error("❌ Get key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =============================
   🚀 Запуск сервера
============================= */
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
