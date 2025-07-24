require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const twilio = require("twilio");

// Adicione isso logo após require("dotenv").config();
console.log("Verificando variáveis de ambiente...");
console.log("TWILIO_SID:", process.env.TWILIO_SID ? "***" : "Não definido");
console.log("GOOGLE_CREDENTIALS:", process.env.GOOGLE_CREDENTIALS ? "***" : "Não definido");
console.log("GOOGLE_TOKEN:", process.env.GOOGLE_TOKEN ? "***" : "Não definido");

if (!process.env.GOOGLE_CREDENTIALS || !process.env.GOOGLE_TOKEN) {
  throw new Error("Variáveis GOOGLE_CREDENTIALS ou GOOGLE_TOKEN não definidas!");
}

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Remetente desejado
const REMETENTE = "priscilaroverssi01@gmail.com";

// Carrega as credenciais do OAuth2
function loadCredentials() {
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
// Função recursiva para extrair o corpo do e-mail
function extractBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts && payload.parts.length > 0) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }

    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64").toString("utf-8");
        return html.replace(/<[^>]+>/g, ""); // remove HTML
      }

      // Recurse se houver partes aninhadas
      if (part.parts && part.parts.length > 0) {
        const result = extractBody(part);
        if (result) return result;
      }
    }
  }

  return "";
}

async function verificarEmail() {
  try {
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    // Buscar até 10 e-mails não lidos do remetente a partir da data desejada
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

    // Buscar detalhes das mensagens e ordenar por data
    const mensagensDetalhadas = await Promise.all(
      messages.map(async msg => {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id });
        const internalDate = parseInt(full.data.internalDate, 10);
        return { id: msg.id, data: full, timestamp: internalDate };
      })
    );

    mensagensDetalhadas.sort((a, b) => b.timestamp - a.timestamp);

    // Pega o e-mail mais recente
    const mensagemRecente = mensagensDetalhadas[0];
    const fullMessage = mensagemRecente.data;

    const headers = fullMessage.data.payload.headers;
    const assunto = headers.find(h => h.name === "Subject")?.value || "(sem assunto)";

    // Extrair corpo do e-mail de forma robusta
    const body = extractBody(fullMessage.data.payload);

    if (!body || !body.trim()) {
      console.log("⚠️ Corpo do e-mail vazio.");
      return;
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
