// Carrega variáveis locais apenas em ambiente de desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config();
}

const { google } = require("googleapis");
const twilio = require("twilio");

// 🔍 Debug: verifique se o Railway está recebendo as variáveis
console.log("🧪 TWILIO_SID:", process.env.TWILIO_SID ? "✅ SET" : "❌ NOT SET");
console.log("🧪 NODE_ENV:", process.env.NODE_ENV);

// ✅ Validação de variáveis obrigatórias
function validateEnvVars() {
  const required = [
    'TWILIO_SID',
    'TWILIO_AUTH_TOKEN', 
    'TWILIO_PHONE',
    'DEST_PHONE',
    'GOOGLE_CREDENTIALS',
    'GOOGLE_TOKEN'
  ];
  
  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
  }
}

// ✅ Inicialização do Twilio
let client;
try {
  validateEnvVars();
  client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log("📞 Twilio client initialized");
} catch (error) {
  console.error("❌ Error initializing Twilio:", error.message);
  process.exit(1);
}

const REMETENTE = "pcrpaintshop@hyundai-brasil.com";

// ✅ Função para carregar credenciais do Google
function loadCredentials() {
  try {
    console.log("🔑 Carregando credenciais Google...");

    if (!process.env.GOOGLE_CREDENTIALS || !process.env.GOOGLE_TOKEN) {
      throw new Error("As variáveis GOOGLE_CREDENTIALS e GOOGLE_TOKEN são obrigatórias.");
    }

    let credentials, token;
    
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (e) {
      throw new Error("GOOGLE_CREDENTIALS contém JSON inválido.");
    }

    try {
      token = JSON.parse(process.env.GOOGLE_TOKEN);
    } catch (e) {
      throw new Error("GOOGLE_TOKEN contém JSON inválido.");
    }

    if (!credentials.installed || !credentials.installed.client_id || !credentials.installed.client_secret || !credentials.installed.redirect_uris) {
      throw new Error("GOOGLE_CREDENTIALS está mal formatado.");
    }

    const oAuth2Client = new google.auth.OAuth2(
      credentials.installed.client_id,
      credentials.installed.client_secret,
      credentials.installed.redirect_uris[0]
    );

    oAuth2Client.setCredentials(token);
    console.log("🔐 Google OAuth carregado com sucesso.");
    return oAuth2Client;
  } catch (error) {
    console.error("❌ Erro nas credenciais Google:", error.message);
    throw error;
  }
}

// ✅ Verifica e envia e-mail
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
      console.log("📭 Nenhum novo e-mail não lido encontrado.");
      return;
    }

    const mensagensDetalhadas = await Promise.all(
      messages.map(async msg => {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id });
        return {
          id: msg.id,
          data: full,
          timestamp: parseInt(full.data.internalDate, 10),
        };
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

    // Remove rodapé de aviso de confidencialidade (pt e en)
    body = body.replace(/Atenção:[\s\S]*$/i, "").trim();
    body = body.replace(/Warning:[\s\S]*$/i, "").trim();


    console.log(`📝 E-mail recebido: ${assunto}`);

    const partes = body.match(/.{1,1000}/gs) || [];

    for (let i = 0; i < partes.length; i++) {
      const texto = partes[i];

      await client.messages.create({
        from: process.env.TWILIO_PHONE,
        to: process.env.DEST_PHONE,
        body: texto,
      });

      console.log(`✅ Parte ${i + 1} enviada ao WhatsApp.`);
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: mensagemRecente.id,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });

    console.log("✅ E-mail marcado como lido.");
  } catch (error) {
    console.error("❌ Erro ao processar e-mail:", error.message);
    if (error.response?.data) {
      console.error("API Response:", error.response.data);
    }
    if (error.code) {
      console.error("Código do erro:", error.code);
    }
  }
}

// ✅ Inicializa
console.log("🚀 Serviço de monitoramento iniciado...");
verificarEmail().then(() => {
  console.log("📧 Primeira verificação concluída.");
}).catch(error => {
  console.error("❌ Falha na verificação inicial:", error.message);
});

// ✅ Repetição a cada 10 segundos
setInterval(verificarEmail, 10000);
