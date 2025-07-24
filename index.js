// Configuração inicial - REMOVA dotenv para produção no Railway
// require("dotenv").config(); // Não é necessário no Railway
const { google } = require("googleapis");
const twilio = require("twilio");

// Verificação robusta de variáveis de ambiente
console.log("🔄 Verificando variáveis de ambiente...");
const requiredVars = [
  'TWILIO_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE',
  'DEST_PHONE',
  'GOOGLE_CREDENTIALS',
  'GOOGLE_TOKEN'
];

let missingVars = [];
requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
    console.error(`❌ ${varName}: Não definido`);
  } else {
    console.log(`✅ ${varName}: Definido`);
  }
});

if (missingVars.length > 0) {
  throw new Error(`Variáveis de ambiente ausentes: ${missingVars.join(', ')}`);
}

// Inicializa o cliente Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const REMETENTE = "priscilaroverssi01@gmail.com";

// Função para carregar credenciais do Google com tratamento de erros
function loadCredentials() {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const token = JSON.parse(process.env.GOOGLE_TOKEN);

    if (!credentials.installed || !token.access_token) {
      throw new Error("Estrutura do JSON inválida");
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
    
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } catch (error) {
    console.error("❌ Erro ao carregar credenciais do Google:", error.message);
    throw error;
  }
}

// Função melhorada para extrair o corpo do e-mail
function extractBody(payload) {
  try {
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf-8");
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64").toString("utf-8");
        }
        if (part.mimeType === "text/html" && part.body?.data) {
          const html = Buffer.from(part.body.data, "base64").toString("utf-8");
          return html.replace(/<[^>]+>/g, ""); // Remove tags HTML
        }
        if (part.parts) {
          const result = extractBody(part);
          if (result) return result;
        }
      }
    }
    return "";
  } catch (error) {
    console.error("❌ Erro ao extrair corpo do e-mail:", error.message);
    return "";
  }
}

// Função principal para verificar e-mails
async function verificarEmail() {
  try {
    console.log("\n🔍 Verificando e-mails...");
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    // Busca e-mails não lidos (últimas 24 horas)
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${REMETENTE} is:unread after:${getFormattedDate(1)}`,
      maxResults: 10,
    });

    const messages = res.data.messages || [];
    console.log(`📨 E-mails não lidos encontrados: ${messages.length}`);

    if (messages.length === 0) return;

    // Processa o e-mail mais recente
    const mostRecent = await getEmailDetails(gmail, messages[0].id);
    const { subject, body } = processEmail(mostRecent.payload);

    if (!body) {
      console.log("⚠️ E-mail sem conteúdo legível.");
      return;
    }

    // Envia para WhatsApp em partes
    await sendWhatsAppMessage(subject, body);

    // Marca como lido
    await gmail.users.messages.modify({
      userId: "me",
      id: mostRecent.id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });

    console.log("✅ E-mail processado com sucesso!");

  } catch (error) {
    console.error("❌ Erro na verificação de e-mail:", error.message);
  }
}

// Funções auxiliares
function getFormattedDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

async function getEmailDetails(gmail, id) {
  const email = await gmail.users.messages.get({ userId: "me", id });
  return {
    id,
    payload: email.data.payload,
    internalDate: parseInt(email.data.internalDate, 10)
  };
}

function processEmail(payload) {
  const headers = payload.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "(sem assunto)";
  const body = extractBody(payload);
  return { subject, body };
}

async function sendWhatsAppMessage(subject, body) {
  const chunks = body.match(/.{1,1000}/gs) || [];
  
  for (let i = 0; i < chunks.length; i++) {
    const text = `📬 Novo e-mail de ${REMETENTE}\nAssunto: ${subject}\n\nParte ${i + 1}:\n\n${chunks[i]}`;
    
    await client.messages.create({
      from: process.env.TWILIO_PHONE,
      to: process.env.DEST_PHONE,
      body: text,
    });

    console.log(`✅ Parte ${i + 1} enviada ao WhatsApp.`);
  }
}

// Controle de execução para evitar sobreposição
let isRunning = false;
async function runWithInterval() {
  if (isRunning) {
    console.log("⏳ Operação anterior ainda em andamento...");
    return;
  }
  
  try {
    isRunning = true;
    await verificarEmail();
  } catch (error) {
    console.error("❌ Erro no loop principal:", error.message);
  } finally {
    isRunning = false;
  }
}

// Inicia o serviço
console.log("\n🚀 Serviço iniciado com sucesso!");
runWithInterval();
setInterval(runWithInterval, 10000);