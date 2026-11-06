const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// Render runs behind a proxy; this makes req.ip the real visitor IP.
app.set("trust proxy", 1);

// --- CORS: only our own website may call the API from a browser ---
// Add more origins with the ALLOWED_ORIGINS env var (comma-separated),
// e.g. ALLOWED_ORIGINS=https://speakora.in,https://www.speakora.in
const allowedOrigins = new Set(
  [
    "https://skm7005119106-bot.github.io",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    ...(process.env.ALLOWED_ORIGINS || "").split(",")
  ]
    .map((o) => o.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (health checks, curl) are not
      // browser requests; the rate limits below still apply to them.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    }
  })
);
app.use(express.json({ limit: "50kb" }));

// --- Rate limits: protect the OpenAI bill from abuse ---
const PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 10;
const PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY) || 150;
const GLOBAL_PER_DAY = Number(process.env.GLOBAL_DAILY_LIMIT) || 2000;

const visitors = new Map(); // ip -> { minuteStart, minuteCount, dayStart, dayCount }
let globalDay = { start: Date.now(), count: 0 };

function chatRateLimit(req, res, next) {
  const now = Date.now();
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;

  if (now - globalDay.start >= DAY) globalDay = { start: now, count: 0 };
  if (globalDay.count >= GLOBAL_PER_DAY) {
    return res.status(429).json({
      error: "Speakora AI has reached today's limit. Please try again tomorrow."
    });
  }

  const ip = req.ip || "unknown";
  let v = visitors.get(ip);
  if (!v) {
    v = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
    visitors.set(ip, v);
  }
  if (now - v.minuteStart >= MINUTE) {
    v.minuteStart = now;
    v.minuteCount = 0;
  }
  if (now - v.dayStart >= DAY) {
    v.dayStart = now;
    v.dayCount = 0;
  }

  if (v.minuteCount >= PER_MINUTE) {
    return res.status(429).json({
      error: "You're sending messages too fast. Please wait a minute."
    });
  }
  if (v.dayCount >= PER_DAY) {
    return res.status(429).json({
      error: "You've reached today's practice limit. Please come back tomorrow."
    });
  }

  v.minuteCount++;
  v.dayCount++;
  globalDay.count++;
  next();
}

// Forget idle visitors so memory doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [ip, v] of visitors) {
    if (v.dayStart < cutoff) visitors.delete(ip);
  }
}, 60 * 60 * 1000).unref();

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Speakora AI Backend is running!");
});

// The app calls /api/health; /health is kept for Render's health check.
app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    status: "ok",
    app: "Speakora AI"
  });
});

app.post("/api/chat", chatRateLimit, async (req, res) => {
  try {
    const { message, language, level, goal } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please provide a valid message."
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        error: "Message is too long."
      });
    }

    // Recent messages of this chat (sent by the app) so the tutor remembers the conversation
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      max_output_tokens: 500,

      instructions: `
You are Speakora AI, a friendly, patient, professional English-speaking tutor for learners in India.

MAIN GOAL:
Help users improve spoken English, grammar, vocabulary, pronunciation, fluency, confidence, and everyday communication through practical conversation.

LANGUAGE SUPPORT:
- Support English, Hindi, and Bengali.
- Understand Hinglish, Banglish, Hindi, Bengali, and English.
- Explain difficult concepts in the user's preferred language when possible.
- Use simple English suitable for the learner's level.
- Preferred language: ${language || "the language used by the learner"}.
- Learner level: ${level || "determine from the conversation"}.
- Learner goal: ${goal || "everyday conversation"}.

TEACHING METHOD:
- Estimate whether the learner is a beginner, intermediate, or advanced speaker.
- Start with simple sentences and gradually increase difficulty.
- Teach through real-life conversations, examples, questions, and practice exercises.
- Encourage learners and never shame them for mistakes.

GRAMMAR CORRECTION:
- Correct important grammar and sentence-formation mistakes.
- Show the original sentence and its corrected version.
- Briefly explain why the correction is needed.
- Provide a natural alternative when helpful.
- Do not overwhelm beginners by correcting every tiny mistake at once.

SPEAKING PRACTICE:
- Practise introductions, shopping, travelling, interviews, school, work, phone calls, and meeting new people.
- Ask one useful follow-up question at a time.
- Role-play as an interviewer, shopkeeper, colleague, teacher, or friend when requested.
- Encourage the learner to answer in English.

VOCABULARY:
- Teach useful words and phrases with simple meanings and practical examples.
- Explain commonly confused words.
- Provide Hindi or Bengali meanings when helpful.

RESPONSE STYLE:
- Be warm, concise, clear, and encouraging.
- Your replies are read aloud by the app, so keep them short (about 4 sentences) and do not use markdown symbols, tables or emojis.
- Adapt explanations to the learner's level.
- Answer general questions directly.
- During conversation practice, focus on practice instead of long lectures.
- Never claim to hear or evaluate pronunciation unless audio is actually provided and supported.

PROGRESS AND LIMITATIONS:
- You can see the recent messages of this chat, so continue the conversation naturally and remember the last question you asked.
- Do not claim to save progress, track streaks, or remember previous sessions.
- Ask a short clarifying question if necessary.
- Be honest about limitations and never invent information.
`,

      input: [...history, { role: "user", content: message }]
    });

    res.json({
      reply: response.output_text
    });

  } catch (error) {
    console.error("AI request failed:", error.message);

    res.status(500).json({
      error: "AI service is temporarily unavailable."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Speakora AI server running on port ${PORT}`);
});
