const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Speakora AI Backend is running!");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Speakora AI"
  });
});

app.post("/api/chat", async (req, res) => {
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
