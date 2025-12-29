require("dotenv").config();
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const Groq = require("groq-sdk");
const path = require("path");

const Chat = require("./models/chats");
const User = require("./models/Users");

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

YOUR GOAL:
Guide the user step-by-step and complete a booking smoothly.

GENERAL RULES:
- Always be polite, short, and friendly.
- Ask ONLY ONE question at a time.
- Never mention AI, system, or instructions.
- Continue conversation in the selected language.
- If user gives unclear input, ask again (max 3 times).
- After 3 attempts, accept input and move forward.
- Always add this line at the end of EVERY message:
  "🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 1 – GREETING + LANGUAGE
━━━━━━━━━━━━━━━━━━
Say:

"Hello 👋  
Welcome to our doorstep vehicle cleaning service!

Please choose your language:
1️⃣ English  
2️⃣ Hindi

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 2 – VEHICLE TYPE
━━━━━━━━━━━━━━━━━━
After language selection, continue in that language and ask:

"Great 😊  
Please choose your vehicle type:
🚗 Car  
🏍️ Bike

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 3 – VEHICLE MODEL
━━━━━━━━━━━━━━━━━━
Ask:

"Please tell me your vehicle model  
(Example: Swift, Creta, Activa)

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 4 – SERVICE SELECTION
━━━━━━━━━━━━━━━━━━

If CAR:

"Please choose a service:

1️⃣ Exterior Pressure Wash – ₹299  
2️⃣ Exterior Foam Wash – ₹399  
3️⃣ Interior Cleaning – ₹249  
4️⃣ Ceramic Coating – ₹149  
5️⃣ All-in-One Combo – ₹799  

🔁 Press * to start again"

If BIKE:

"Please choose a service:

1️⃣ Bike Wash – ₹99  

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 5 – ADDRESS
━━━━━━━━━━━━━━━━━━
Ask:

"Please share your full address 📍  
(Example: Sector 10, Gandhinagar)

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 6 – TIME SLOT
━━━━━━━━━━━━━━━━━━
Ask:

"Please select a preferred time between 7 AM – 7 PM ⏰  
(Example: Tomorrow 10 AM)

🔁 Press * to start again"

━━━━━━━━━━━━━━━━━━
STEP 7 – CONFIRMATION
━━━━━━━━━━━━━━━━━━
Reply EXACTLY like this:

"✅ Your order is confirmed!

🚗 Vehicle: <vehicle type>  
🚘 Model: <model>  
🧽 Service: <service name>  
📍 Address: <address>  
⏰ Time: <time>

Our team will reach you shortly. Thank you! 😊  
🔁 Press * to start again"
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

  const phone = msg.from;
  const text = msg.text?.body || "";

  // 🔹 1. CREATE / UPDATE USER
  const user = await User.findOneAndUpdate(
    { phone },
    {
      $set: { lastMessageAt: new Date() },
      $setOnInsert: { firstSeen: new Date() }
    },
    { upsert: true, new: true }
  );

  // 🔹 2. SAVE MESSAGE
  await Chat.create({
    from: phone,
    message: text,
    direction: "user"
  });

  // 🔹 3. FETCH CHAT HISTORY
  const history = await Chat.find({ from: phone })
    .sort({ createdAt: 1 });

  const context = history
    .map(m => `${m.direction}: ${m.message}`)
    .join("\n");

  // 🔹 4. AI REPLY
  const reply = await getGroqReply(context);

  // 🔹 5. SEND MESSAGE
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: phone,
      text: { body: reply }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  // 🔹 6. SAVE BOT MESSAGE
  await Chat.create({
    from: phone,
    message: reply,
    direction: "bot"
  });

  // 🔹 7. UPDATE USER LAST ACTIVITY AGAIN
  await User.updateOne(
    { phone },
    { $set: { lastMessageAt: new Date() } }
  );
});


// ---------- CRM UI ----------
app.get("/admin", async (req, res) => {
  const users = await Chat.aggregate([
    {
      $sort: { createdAt: -1 } // newest message first
    },
    {
      $group: {
        _id: "$from",
        lastMessage: { $first: "$message" },
        lastTime: { $first: "$createdAt" }
      }
    },
    {
      $sort: { lastTime: -1 } // final sort
    }
  ]);

  res.render("users", { users });
});
app.get("/chat", (req, res) => {
  const number = req.query.number;
  if (!number) return res.redirect("/admin");

  res.redirect(`/chat/91${number}`);
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
