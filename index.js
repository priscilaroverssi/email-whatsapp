require("dotenv").config();

const { google } = require("googleapis");
const twilio = require("twilio");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const os = require("os");
const path = require("path");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function validateEnvVars() {
  const required = [
    "TWILIO_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE",
    "DEST_PHONE",
    "GOOGLE_CREDENTIALS",
    "GOOGLE_TOKEN",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Faltando variável: ${key}`);
      process.exit(1);
    }
  }
}

validateEnvVars();

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
console.log("✅ Twilio configurado");

const REMETENTE = "pcrpaintshop@hyundai-brasil.com";

function loadCredentials() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const token = JSON.parse(process.env.GOOGLE_TOKEN);

  const oAuth2Client = new google.auth.OAuth2(
    credentials.installed.client_id,
    credentials.installed.client_secret,
    credentials.installed.redirect_uris[0]
  );
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

async function uploadToCloudinary(filename, buffer) {
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, buffer);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
      folder: "emails",
    });
    fs.unlinkSync(filePath);
    return result.secure_url;
  } catch (err) {
    console.error("❌ Cloudinary upload failed:", err.message);
    return null;
  }
}

function decodeBase64(data) {
  return Buffer.from(data, "base64").toString("utf-8");
}

function extractBody(payload) {
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result.replace(/<[^>]+>/g, "");
    }
  }
  return "";
}

async function verificarEmail() {
  try {
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${REMETENTE} is:unread after:2025/07/22`,
      maxResults: 10,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      console.log("📭 Nenhum e-mail novo não lido.");
      return;
    }

    const message = await gmail.users.messages.get({
      userId: "me",
      id: messages[0].id,
    });

    const headers = message.data.payload.headers;
    const subject = headers.find((h) => h.name === "Subject")?.value || "(sem assunto)";

    let body = extractBody(message.data.payload)
      .replace(/Atenção:[\s\S]*$/i, "")
      .replace(/Warning:[\s\S]*$/i, "")
      .trim();

    console.log(`📨 Assunto: ${subject}`);

    const partes = body.match(/.{1,1000}/gs) || [];
    for (let parte of partes) {
      await client.messages.create({
        from: process.env.TWILIO_PHONE,
        to: process.env.DEST_PHONE,
        body: parte,
      });
    }

    const attachments = [];
    const parts = message.data.payload.parts || [];
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({ filename: part.filename, id: part.body.attachmentId });
      }
    }

    for (const att of attachments) {
      const attachment = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: messages[0].id,
        id: att.id,
      });

      const buffer = Buffer.from(attachment.data.data, "base64");
      const url = await uploadToCloudinary(att.filename, buffer);

      if (url) {
        await client.messages.create({
          from: process.env.TWILIO_PHONE,
          to: process.env.DEST_PHONE,
          body: `📎 Anexo: ${att.filename}`,
          mediaUrl: [url],
        });
        console.log(`✅ Anexo enviado: ${att.filename}`);
      }
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: messages[0].id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });

  } catch (err) {
    console.error("❌ Erro ao verificar e-mail:", err.message);
  }
}

console.log("🚀 Monitoramento iniciado...");
verificarEmail().then(() => console.log("✅ Primeira verificação completa"));
setInterval(verificarEmail, 10000); // A cada 10s
