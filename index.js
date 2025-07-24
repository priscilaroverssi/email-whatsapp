const { google } = require("googleapis");
const twilio = require("twilio");

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Remetente desejado
const REMETENTE = "priscilaroverssi01@gmail.com";

// Carrega as credenciais do OAuth2 usando variáveis de ambiente
function loadCredentials() {
  try {
    // Parse das credenciais e token das variáveis de ambiente
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
  } catch (error) {
    console.error("❌ Erro ao carregar credenciais:", error.message);
    throw error;
  }
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

// Função para iniciar o serviço
async function iniciarServico() {
  console.log("🚀 Iniciando serviço de monitoramento de e-mail...");
  
  // Verificação inicial
  await verificarEmail();
  
  // Verifica a cada 10 segundos
  setInterval(verificarEmail, 10000);
}

// Para Railway: escuta na porta fornecida ou 3000
const PORT = process.env.PORT || 3000;

// Criar um servidor HTTP básico para manter o serviço ativo no Railway
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'Email-WhatsApp service running',
    timestamp: new Date().toISOString()
  }));
});

server.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
  iniciarServico();
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});