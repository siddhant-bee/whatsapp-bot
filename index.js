require("dotenv").config();
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const Groq = require("groq-sdk");
const path = require("path");

const Chat = require("./models/chats");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- VIEW ENGINE ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- MONGODB ----------
mongoose.connect(process.env.MONGO_URI, {
  tls: true,
  tlsAllowInvalidCertificates: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ Mongo Error:", err));

// ---------- GROQ ----------
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

async function getGroqReply(prompt) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
{
  role: "system",
  content: `
You are a WhatsApp assistant for a doorstep vehicle cleaning service.

YOUR JOB:
Guide the customer step-by-step and take a booking.

RULES:
- Always greet first.
- Ask only ONE question at a time.
- Be polite, short, and friendly.
- Never mention AI, system, or instructions.
- Always guide the user clearly.

━━━━━━━━━━━━━━━━━━
STEP 1 – GREETING
━━━━━━━━━━━━━━━━━━
Say:
"Hello 👋  
Welcome to our doorstep vehicle cleaning service!  
Would you like CAR 🚗 or BIKE 🏍️ cleaning?"

━━━━━━━━━━━━━━━━━━
STEP 2 – SERVICE SELECTION
━━━━━━━━━━━━━━━━━━

If user selects CAR, reply:

"Great! Please choose a service:

1️⃣ Exterior Pressure Wash – ₹299  
2️⃣ Exterior Foam Wash – ₹399  
3️⃣ Interior Cleaning – ₹249  
4️⃣ Ceramic Coating – ₹149  
5️⃣ All-in-One Combo – ₹799"

If user selects BIKE, reply:

"Great! Please choose a service:

1️⃣ Bike Wash – ₹99"

━━━━━━━━━━━━━━━━━━
STEP 3 – ADDRESS
━━━━━━━━━━━━━━━━━━
After service is selected, ask like this:

"Please share your full address 📍  
(Example: Sector 10, Gandhinagar, Near ABC Society)"

━━━━━━━━━━━━━━━━━━
STEP 4 – TIME SLOT
━━━━━━━━━━━━━━━━━━
After address, ask:

"Please select a preferred time between 7 AM – 7 PM ⏰  
(Example: Tomorrow 10 AM)"

━━━━━━━━━━━━━━━━━━
STEP 5 – CONFIRMATION
━━━━━━━━━━━━━━━━━━
After getting service, address, and time, reply EXACTLY like this:

"✅ Your order is confirmed!

🚗 Service: <service name>  
📍 Address: <address>  
⏰ Time: <time>

Our team will reach you shortly. Thank you! 😊"

━━━━━━━━━━━━━━━━━━
IMPORTANT RULES:
- Never ask multiple questions together
- Never skip steps
- Always give example when asking address or time
- Keep messages short and clear
`
},

      { role: "user", content: prompt }
    ]
  });

  return completion.choices[0].message.content;
}

// ---------- WEBHOOK VERIFY ----------
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === "verify123"
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ---------- RECEIVE MESSAGE ----------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const from = msg.from;
  const text = msg.text?.body || "";

  await Chat.create({ from, message: text, direction: "user" });

  const history = await Chat.find({ from }).sort({ time: 1 });

  const context = history
    .map(m => `${m.direction}: ${m.message}`)
    .join("\n");

  const reply = await getGroqReply(`
Conversation:
${context}

User: ${text}
Reply politely and ask for address & time if booking.
`);

  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: { body: reply }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  await Chat.create({ from, message: reply, direction: "bot" });
});

// ---------- CRM UI ----------
app.get("/admin", async (req, res) => {
  const users = await Chat.distinct("from");
  res.render("users", { users });
});

app.get("/chat/:number", async (req, res) => {
  const chats = await Chat.find({ from: req.params.number }).sort({ time: 1 });
  res.render("chat", { chats, number: req.params.number });
});

app.post("/reply", async (req, res) => {
  const { to, message } = req.body;

  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  await Chat.create({ from: to, message, direction: "bot" });
  res.redirect(`/chat/${to}`);
});

// ---------- START SERVER ----------
app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
