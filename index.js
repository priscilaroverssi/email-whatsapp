require("dotenv").config();
const { google } = require("googleapis");
const twilio = require("twilio");

// Instancia o cliente Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Remetente agora como variável de ambiente
const REMETENTE = process.env.REMETENTE;

// Carrega as credenciais a partir das variáveis de ambiente
function loadCredentials() {
  if (!process.env.GOOGLE_CREDENTIALS || !process.env.GOOGLE_TOKEN) {
    throw new Error("❌ GOOGLE_CREDENTIALS ou GOOGLE_TOKEN não estão definidas.");
  }

  console.log("🔍 GOOGLE_CREDENTIALS carregado (50 chars):", process.env.GOOGLE_CREDENTIALS?.substring(0, 50));

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const token = JSON.parse(process.env.GOOGLE_TOKEN);

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
      q: `from:${REMETENTE} is:unread after:2025/07/22`,
      maxResults: 10,
    });

    const messages = res.data.messages || [];

    if (messages.length === 0) {
      console.log("📭 Nenhum novo e-mail não lido do remetente após 22/07/2025.");
      return;
    }

    const mensagensDetalhadas = await Promise.all(
      messages.map(async msg => {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id });
        const internalDate = parseInt(full.data.internalDate, 10);
        return { id: msg.id, data: full, timestamp: internalDate };
      })
    );

    mensagensDetalhadas.sort((a, b) => b.timestamp - a.timestamp);
    const mensagemRecente = mensagensDetalhadas[0];
    const fullMessage = mensagemRecente.data;

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
          body = htmlBody.replace(/<[^>]+>/g, "");
          break;
        }
      }
    } else if (fullMessage.data.payload.body?.data) {
      body = Buffer.from(fullMessage.data.payload.body.data, "base64").toString("utf-8");
    }

    if (!body) {
      console.log("⚠️ Corpo do e-mail vazio.");
      return;
    }

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

    await gmail.users.messages.modify({
      userId: "me",
      id: mensagemRecente.id,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });

    console.log("✅ E-mail marcado como lido.\n");

  } catch (error) {
    console.error("❌ Erro ao verificar/enviar e-mail:", error.message);
  }
}

// Verifica a cada 10 segundos
setInterval(verificarEmail, 10000);
