require("dotenv").config();
const { google } = require("googleapis");
const twilio = require("twilio");

// Configuração do Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Carrega as credenciais do OAuth2 a partir das variáveis de ambiente
function loadCredentials() {
  try {
    // Verifica se as variáveis de ambiente existem
    if (!process.env.GOOGLE_CREDENTIALS || !process.env.GOOGLE_TOKEN) {
      throw new Error("Variáveis GOOGLE_CREDENTIALS ou GOOGLE_TOKEN não encontradas");
    }

    // Remove possíveis caracteres inválidos que podem ter sido adicionados ao copiar/colar
    const cleanCredentials = process.env.GOOGLE_CREDENTIALS.replace(/\\n/g, '').trim();
    const cleanToken = process.env.GOOGLE_TOKEN.replace(/\\n/g, '').trim();

    const credentials = JSON.parse(cleanCredentials);
    const token = JSON.parse(cleanToken);

    const { client_secret, client_id, redirect_uris } = credentials.installed;

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    oAuth2Client.setCredentials(token);

    return oAuth2Client;
  } catch (error) {
    console.error("❌ Erro ao carregar credenciais:", error.message);
    console.error("Detalhes do erro:", error);
    throw error;
  }
}

async function verificarEmail() {
  try {
    console.log("🔍 Verificando novos e-mails...");
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    // Buscar até 10 e-mails não lidos do remetente a partir da data desejada
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${process.env.REMENTE} is:unread`,
      maxResults: 10,
    });

    const messages = res.data.messages || [];

    if (messages.length === 0) {
      console.log("📭 Nenhum novo e-mail não lido do remetente.");
      return;
    }

    // Buscar detalhes das mensagens e ordenar por data
    const mensagensDetalhadas = await Promise.all(
      messages.map(async (msg) => {
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
    const assunto = headers.find((h) => h.name === "Subject")?.value || "(sem assunto)";
    const remetente = headers.find((h) => h.name === "From")?.value || process.env.REMENTE;

    let body = "";

    const parts = fullMessage.data.payload.parts;

    if (parts && parts.length > 0) {
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        } else if (part.mimeType === "text/html" && part.body?.data) {
          const htmlBody = Buffer.from(part.body.data, "base64").toString("utf-8");
          body = htmlBody.replace(/<[^>]+>/g, ""); // remove HTML
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

    // Limita o tamanho do corpo para evitar exceder limites do WhatsApp
    body = body.substring(0, 3000); // WhatsApp tem limite de ~4096 caracteres por mensagem

    // Prepara a mensagem para o WhatsApp
    const texto = `📬 Novo e-mail de ${remetente}\nAssunto: ${assunto}\n\n${body}`;

    await client.messages.create({
      from: process.env.TWILIO_PHONE,
      to: process.env.DEST_PHONE,
      body: texto,
    });

    console.log("✅ E-mail enviado com sucesso ao WhatsApp.");

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

// Verifica a cada 1 minuto (60000 ms) - ajuste conforme necessário
const intervalo = process.env.INTERVALO || 60000;
console.log(`⏱️ Iniciando verificação de e-mails a cada ${intervalo / 1000} segundos...`);
setInterval(verificarEmail, intervalo);

// Executa imediatamente ao iniciar
verificarEmail();