require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const twilio = require("twilio");

// Validate environment variables
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

// Initialize Twilio client
let client;
try {
  validateEnvVars();
  client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log("✅ Twilio client initialized successfully");
} catch (error) {
  console.error("❌ Error initializing:", error.message);
  process.exit(1);
}

// Remetente desejado
const REMETENTE = "priscilaroverssi01@gmail.com";

// Carrega as credenciais do OAuth2
function loadCredentials() {
  try {
    console.log("🔑 Loading Google credentials...");
    
    // Check if credentials exist
    if (!process.env.GOOGLE_CREDENTIALS) {
      throw new Error("GOOGLE_CREDENTIALS environment variable is not set");
    }
    
    if (!process.env.GOOGLE_TOKEN) {
      throw new Error("GOOGLE_TOKEN environment variable is not set");
    }

    // Parse JSON with better error handling
    let credentials, token;
    
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (parseError) {
      throw new Error(`Invalid JSON in GOOGLE_CREDENTIALS: ${parseError.message}`);
    }
    
    try {
      token = JSON.parse(process.env.GOOGLE_TOKEN);
    } catch (parseError) {
      throw new Error(`Invalid JSON in GOOGLE_TOKEN: ${parseError.message}`);
    }

    // Validate credentials structure
    if (!credentials.installed) {
      throw new Error("GOOGLE_CREDENTIALS must have 'installed' property");
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed;
    
    if (!client_secret || !client_id || !redirect_uris) {
      throw new Error("Missing required fields in GOOGLE_CREDENTIALS");
    }

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
    
    oAuth2Client.setCredentials(token);
    console.log("✅ Google credentials loaded successfully");
    return oAuth2Client;
    
  } catch (error) {
    console.error("❌ Error loading credentials:", error.message);
    throw error;
  }
}

async function verificarEmail() {
  try {
    console.log("📧 Checking for new emails...");
    
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

    console.log(`📬 Found ${messages.length} unread emails`);

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

    console.log(`📝 Processing email with subject: ${assunto}`);

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
    
    // More detailed error logging
    if (error.response) {
      console.error("API Response Error:", error.response.data);
    }
    if (error.code) {
      console.error("Error Code:", error.code);
    }
  }
}

// Initial check
console.log("🚀 Starting email monitoring service...");
verificarEmail().then(() => {
  console.log("📧 Initial email check completed");
}).catch(error => {
  console.error("❌ Initial check failed:", error.message);
});

// Verifica a cada 10 segundos
setInterval(verificarEmail, 10000);