require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Remetente desejado
const REMETENTE = "priscilaroverssi01@gmail.com";

// Carrega as credenciais do OAuth2
function loadCredentials() {
  const credentialsPath = path.join(__dirname, "credentials.json");
  const tokenPath = path.join(__dirname, "token.json");

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));

  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.setCredentials(token);

  return oAuth2Client;
}

async function verificarEmail() {
  try {
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${REMETENTE} is:unread`,
      maxResults: 5,
    });

    const messages = res.data.messages || [];

    for (let msg of messages) {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
      });

      const headers = fullMessage.data.payload.headers;
      const assunto = headers.find(h => h.name === "Subject")?.value || "(sem assunto)";

      let body = "";

      const parts = fullMessage.data.payload.parts;

      if (parts && parts.length > 0) {
        for (const part of parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
            break;
          } else if (part.mimeType === "text/html" && part.body?.data) {
            const htmlBody = Buffer.from(part.body.data, "base64").toString("utf-8");
            body = htmlBody.replace(/<[^>]+>/g, ""); // limpa HTML
            break;
          }
        }
      } else if (fullMessage.data.payload.body?.data) {
        body = Buffer.from(fullMessage.data.payload.body.data, "base64").toString("utf-8");
      }

      if (!body) {
        console.log("⚠️ Corpo do e-mail vazio.");
        continue;
      }

      // Divide o corpo em partes de até 1000 caracteres
      const partes = body.match(/.{1,1000}/gs) || [];

      for (let i = 0; i < partes.length; i++) {
        const texto = `📬 Novo e-mail de ${REMETENTE}\nAssunto: ${assunto}\n\nParte ${i + 1}:\n\n${partes[i]}`;
        
        await client.messages.create({
          from: process.env.TWILIO_PHONE,
          to: process.env.DEST_PHONE,
          body: texto,
        });

        console.log(`✅ Parte ${i + 1} enviada com sucesso ao WhatsApp.`);
      }

      // Marca como lido para não repetir
      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      });

      console.log("✅ E-mail marcado como lido.\n");
    }
  } catch (error) {
    console.error("❌ Erro ao verificar/enviar e-mail:", error.message);
  }
}

// Verifica a cada 10 segundos
setInterval(verificarEmail, 10000);
