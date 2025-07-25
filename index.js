// Carrega variáveis locais apenas em ambiente de desenvolvimento
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const { google } = require("googleapis");
const twilio = require("twilio");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("🔍 TWILIO_SID:", process.env.TWILIO_SID ? "✅ SET" : "❌ NOT SET");
console.log("🔍 NODE_ENV:", process.env.NODE_ENV);

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

  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
  }
}

let client;
try {
  validateEnvVars();
  client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log("📞 Twilio client initialized");
} catch (error) {
  console.error("❌ Error initializing Twilio:", error.message);
  process.exit(1);
}

const REMETENTE = "priscilaroverssi01@gmail.com";

function loadCredentials() {
  try {
    console.log("🔑 Carregando credenciais Google...");

    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const token = JSON.parse(process.env.GOOGLE_TOKEN);

    const oAuth2Client = new google.auth.OAuth2(
      credentials.installed.client_id,
      credentials.installed.client_secret,
      credentials.installed.redirect_uris[0]
    );

    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } catch (error) {
    console.error("❌ Erro nas credenciais Google:", error.message);
    throw error;
  }
}

async function uploadToCloudinary(filename, buffer) {
  const tempPath = `/tmp/${filename}`;
  fs.writeFileSync(tempPath, buffer);

  try {
    const result = await cloudinary.uploader.upload(tempPath, {
      resource_type: "auto",
      folder: "emails",
    });
    fs.unlinkSync(tempPath);
    return result.secure_url;
  } catch (err) {
    console.error("Erro ao enviar para Cloudinary:", err.message);
    return null;
  }
}

async function verificarEmail() {
  try {
    console.log("📧 Verificando e-mails...");
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${REMETENTE} is:unread after:2025/07/22`,
      maxResults: 10,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      console.log("📬 Nenhum novo e-mail não lido encontrado.");
      return;
    }

    const full = await gmail.users.messages.get({
      userId: "me",
      id: messages[0].id,
    });

    const headers = full.data.payload.headers;
    const assunto = headers.find((h) => h.name === "Subject")?.value || "(sem assunto)";

    const decodeBase64 = (data) => Buffer.from(data, "base64").toString("utf-8");

    function extractBody(payload) {
      if (payload.body?.data) return decodeBase64(payload.body.data);
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.parts) {
            const nested = extractBody(part);
            if (nested) return nested;
          }
          if ((part.mimeType === "text/plain" || part.mimeType === "text/html") && part.body?.data) {
            return decodeBase64(part.body.data).replace(/<[^>]+>/g, "");
          }
        }
      }
      return "";
    }

    let body = extractBody(full.data.payload)
      .replace(/Atenção:[\s\S]*$/i, "")
      .replace(/Warning:[\s\S]*$/i, "").trim();

    console.log(`📝 E-mail recebido: ${assunto}`);

    const partes = body.match(/.{1,1000}/gs) || [];
    for (let i = 0; i < partes.length; i++) {
      await client.messages.create({
        from: process.env.TWILIO_PHONE,
        to: process.env.DEST_PHONE,
        body: partes[i],
      });
    }

    const attachments = [];
    const parts = full.data.payload.parts || [];
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
          body: `📷 Anexo: ${att.filename}`,
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
  } catch (error) {
    console.error("❌ Erro ao processar e-mail:", error.message);
    if (error.response?.data) console.error("API Response:", error.response.data);
    if (error.code) console.error("Código do erro:", error.code);
  }
}

console.log("🚀 Serviço de monitoramento iniciado...");
verificarEmail().then(() => console.log("📧 Primeira verificação concluída."));
setInterval(verificarEmail, 10000);
