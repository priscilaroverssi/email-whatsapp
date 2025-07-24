require("dotenv").config();
const { google } = require("googleapis");
const twilio = require("twilio");

// =============================================
// 🔍 Verificação Inicial das Variáveis de Ambiente
// =============================================
console.log("\n🔍 Verificando variáveis de ambiente...");

const requiredEnvVars = [
  'TWILIO_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE',
  'DEST_PHONE',
  'GOOGLE_CREDENTIALS',
  'GOOGLE_TOKEN'
];

// Verifica se todas as variáveis necessárias estão definidas
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ ERRO CRÍTICO: Variável ausente - ${varName}`);
    process.exit(1); // Encerra o processo se faltar alguma variável
  }
  console.log(`✓ ${varName}: ${varName.includes('TOKEN') || varName.includes('SECRET') ? '***' : process.env[varName].substring(0, 5)}...`);
});

// =============================================
// 🔧 Configuração Inicial
// =============================================
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const REMETENTE = "priscilaroverssi01@gmail.com";

// =============================================
// 🔑 Função para Carregar Credenciais do Google
// =============================================
function loadCredentials() {
  try {
    console.log("\n🔑 Carregando credenciais do Google...");
    
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
    console.log("✅ Credenciais carregadas com sucesso!");
    return oAuth2Client;

  } catch (error) {
    console.error("❌ FALHA NAS CREDENCIAIS:", error.message);
    console.error("Dica: Verifique se GOOGLE_CREDENTIALS e GOOGLE_TOKEN são JSON válidos no Railway!");
    process.exit(1);
  }
}

// =============================================
// 📧 Função para Extrair o Corpo do E-mail
// =============================================
function extractBody(payload) {
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
}

// =============================================
// 🔄 Função Principal para Verificar E-mails
// =============================================
async function verificarEmail() {
  try {
    console.log("\n🔄 Verificando caixa de entrada...");
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    // Busca e-mails não lidos do remetente (últimas 24h)
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `from:${REMETENTE} is:unread after:${getFormattedDate(1)}`, // 1 = dias atrás
      maxResults: 10,
    });

    const messages = res.data.messages || [];
    console.log(`📨 E-mails não lidos encontrados: ${messages.length}`);

    if (messages.length === 0) {
      console.log("📭 Nenhum novo e-mail encontrado.");
      return;
    }

    // Processa o e-mail mais recente
    const mostRecentEmail = await getMostRecentEmail(gmail, messages[0].id);
    const { body, subject } = processEmailPayload(mostRecentEmail.payload);

    if (!body) {
      console.log("⚠️ E-mail sem conteúdo legível.");
      return;
    }

    // Envia para o WhatsApp em partes
    await sendToWhatsApp(subject, body);

    // Marca como lido
    await gmail.users.messages.modify({
      userId: "me",
      id: mostRecentEmail.id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });

    console.log("✅ E-mail processado com sucesso!");

  } catch (error) {
    console.error("❌ ERRO NA VERIFICAÇÃO:", error.message);
  }
}

// =============================================
// 🛠️ Funções Auxiliares
// =============================================
function getFormattedDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

async function getMostRecentEmail(gmail, emailId) {
  const email = await gmail.users.messages.get({ userId: "me", id: emailId });
  return {
    id: emailId,
    payload: email.data.payload,
    internalDate: parseInt(email.data.internalDate, 10)
  };
}

function processEmailPayload(payload) {
  const headers = payload.headers;
  const subject = headers.find(h => h.name === "Subject")?.value || "(sem assunto)";
  const body = extractBody(payload);
  return { subject, body };
}

async function sendToWhatsApp(subject, body) {
  const chunks = body.match(/.{1,1000}/gs) || [];
  
  for (let i = 0; i < chunks.length; i++) {
    const text = `📬 Novo e-mail de ${REMETENTE}\nAssunto: ${subject}\n\nParte ${i + 1}:\n\n${chunks[i]}`;
    
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE}`,
      to: `whatsapp:${process.env.DEST_PHONE}`,
      body: text,
    });

    console.log(`✅ Parte ${i + 1} enviada ao WhatsApp.`);
  }
}

// =============================================
// 🚀 Inicialização do Serviço
// =============================================
let isRunning = false;
setInterval(async () => {
  if (!isRunning) {
    isRunning = true;
    await verificarEmail();
    isRunning = false;
  } else {
    console.log("⏳ Operação anterior ainda em andamento...");
  }
}, 10000); // Verifica a cada 10 segundos

console.log("\n🚀 Serviço iniciado com sucesso! Monitorando e-mails...");