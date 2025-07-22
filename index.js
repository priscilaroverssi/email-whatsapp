require("dotenv").config();
const { google } = require("googleapis");
const twilio = require("twilio");

// Configuração do Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Carrega as credenciais do OAuth2 a partir das variáveis de ambiente
function loadCredentials() {
  try {
    console.log("🔧 Carregando credenciais...");
    
    // Verifica se as variáveis de ambiente existem
    if (!process.env.GOOGLE_CREDENTIALS) {
      throw new Error("❌ Variável GOOGLE_CREDENTIALS não encontrada ou vazia");
    }
    
    if (!process.env.GOOGLE_TOKEN) {
      throw new Error("❌ Variável GOOGLE_TOKEN não encontrada ou vazia");
    }

    console.log("✓ Variáveis de ambiente encontradas");
    console.log(`📝 GOOGLE_CREDENTIALS length: ${process.env.GOOGLE_CREDENTIALS.length}`);
    console.log(`📝 GOOGLE_TOKEN length: ${process.env.GOOGLE_TOKEN.length}`);

    // Remove possíveis caracteres inválidos e espaços extras
    let cleanCredentials = process.env.GOOGLE_CREDENTIALS
      .replace(/\\n/g, '\n')  // Corrige quebras de linha
      .replace(/\\\"/g, '"')  // Corrige aspas escapadas
      .trim();

    let cleanToken = process.env.GOOGLE_TOKEN
      .replace(/\\n/g, '\n')
      .replace(/\\\"/g, '"')
      .trim();

    // Verifica se começa e termina com chaves/colchetes
    if (!cleanCredentials.startsWith('{') || !cleanCredentials.endsWith('}')) {
      console.log("⚠️ GOOGLE_CREDENTIALS não parece ser um JSON válido");
      console.log("Primeiros 100 caracteres:", cleanCredentials.substring(0, 100));
    }

    if (!cleanToken.startsWith('{') || !cleanToken.endsWith('}')) {
      console.log("⚠️ GOOGLE_TOKEN não parece ser um JSON válido");
      console.log("Primeiros 100 caracteres:", cleanToken.substring(0, 100));
    }

    let credentials, token;
    
    try {
      credentials = JSON.parse(cleanCredentials);
      console.log("✓ GOOGLE_CREDENTIALS parsed successfully");
    } catch (parseError) {
      console.error("❌ Erro ao fazer parse de GOOGLE_CREDENTIALS:");
      console.error("Erro:", parseError.message);
      console.error("Conteúdo (primeiros 200 chars):", cleanCredentials.substring(0, 200));
      throw new Error("GOOGLE_CREDENTIALS não é um JSON válido");
    }

    try {
      token = JSON.parse(cleanToken);
      console.log("✓ GOOGLE_TOKEN parsed successfully");
    } catch (parseError) {
      console.error("❌ Erro ao fazer parse de GOOGLE_TOKEN:");
      console.error("Erro:", parseError.message);
      console.error("Conteúdo (primeiros 200 chars):", cleanToken.substring(0, 200));
      throw new Error("GOOGLE_TOKEN não é um JSON válido");
    }

    // Verifica se a estrutura do credentials está correta
    if (!credentials.installed) {
      throw new Error("GOOGLE_CREDENTIALS deve conter um objeto 'installed'");
    }

    const { client_secret, client_id, redirect_uris } = credentials.installed;

    if (!client_secret || !client_id || !redirect_uris) {
      throw new Error("GOOGLE_CREDENTIALS.installed deve conter client_secret, client_id e redirect_uris");
    }

    // Verifica se o token tem a estrutura necessária
    if (!token.access_token) {
      throw new Error("GOOGLE_TOKEN deve conter access_token");
    }

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    oAuth2Client.setCredentials(token);
    console.log("✅ Credenciais OAuth2 configuradas com sucesso");

    return oAuth2Client;
  } catch (error) {
    console.error("❌ Erro ao carregar credenciais:", error.message);
    
    // Informações de debug para ajudar na configuração
    console.log("\n🔍 Debug info:");
    console.log("GOOGLE_CREDENTIALS exists:", !!process.env.GOOGLE_CREDENTIALS);
    console.log("GOOGLE_TOKEN exists:", !!process.env.GOOGLE_TOKEN);
    console.log("REMENTE exists:", !!process.env.REMENTE);
    console.log("TWILIO_SID exists:", !!process.env.TWILIO_SID);
    console.log("TWILIO_AUTH_TOKEN exists:", !!process.env.TWILIO_AUTH_TOKEN);
    console.log("TWILIO_PHONE exists:", !!process.env.TWILIO_PHONE);
    console.log("DEST_PHONE exists:", !!process.env.DEST_PHONE);
    
    throw error;
  }
}

async function verificarEmail() {
  try {
    console.log("🔍 Verificando novos e-mails...");
    const auth = loadCredentials();
    const gmail = google.gmail({ version: "v1", auth });

    // Verifica se o REMENTE está definido
    if (!process.env.REMENTE) {
      throw new Error("Variável REMENTE não está definida");
    }

    // Buscar até 10 e-mails não lidos do remetente
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

    console.log(`📧 Encontrados ${messages.length} e-mails não lidos`);

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
    body = body.substring(0, 3000);

    // Verifica as configurações do Twilio
    if (!process.env.TWILIO_PHONE || !process.env.DEST_PHONE) {
      throw new Error("Variáveis TWILIO_PHONE ou DEST_PHONE não estão definidas");
    }

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
    console.error("Stack trace:", error.stack);
  }
}

// Função para validar todas as variáveis de ambiente necessárias
function validarVariaveisAmbiente() {
  const variaveisNecessarias = [
    'GOOGLE_CREDENTIALS',
    'GOOGLE_TOKEN', 
    'REMENTE',
    'TWILIO_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE',
    'DEST_PHONE'
  ];

  console.log("🔍 Validando variáveis de ambiente...");
  console.log("📍 Ambiente atual:", process.env.NODE_ENV || 'development');
  
  const variaveisFaltando = [];
  const variaveisVazias = [];
  
  for (const variavel of variaveisNecessarias) {
    if (!process.env[variavel]) {
      variaveisFaltando.push(variavel);
      console.log(`❌ ${variavel}: não definida`);
    } else if (process.env[variavel].trim() === '') {
      variaveisVazias.push(variavel);
      console.log(`⚠️ ${variavel}: definida mas vazia`);
    } else {
      console.log(`✅ ${variavel}: definida (${process.env[variavel].length} chars)`);
    }
  }

  if (variaveisFaltando.length > 0 || variaveisVazias.length > 0) {
    console.error("\n❌ PROBLEMAS COM VARIÁVEIS DE AMBIENTE:");
    
    if (variaveisFaltando.length > 0) {
      console.error("🚫 Variáveis não definidas:");
      variaveisFaltando.forEach(v => console.error(`  - ${v}`));
    }
    
    if (variaveisVazias.length > 0) {
      console.error("⚠️ Variáveis vazias:");
      variaveisVazias.forEach(v => console.error(`  - ${v}`));
    }
    
    console.error("\n📋 INSTRUÇÕES PARA RAILWAY:");
    console.error("1. Acesse seu projeto no Railway");
    console.error("2. Vá na aba 'Variables'");
    console.error("3. Adicione as variáveis faltando:");
    
    if (variaveisFaltando.includes('GOOGLE_CREDENTIALS')) {
      console.error("   GOOGLE_CREDENTIALS = (cole o JSON das credenciais OAuth2 do Google)");
    }
    if (variaveisFaltando.includes('GOOGLE_TOKEN')) {
      console.error("   GOOGLE_TOKEN = (cole o JSON do token OAuth2)");
    }
    if (variaveisFaltando.includes('REMENTE')) {
      console.error("   REMENTE = email@exemplo.com");
    }
    if (variaveisFaltando.includes('TWILIO_SID')) {
      console.error("   TWILIO_SID = (seu Twilio Account SID)");
    }
    if (variaveisFaltando.includes('TWILIO_AUTH_TOKEN')) {
      console.error("   TWILIO_AUTH_TOKEN = (seu Twilio Auth Token)");
    }
    if (variaveisFaltando.includes('TWILIO_PHONE')) {
      console.error("   TWILIO_PHONE = +15551234567 (número do Twilio)");
    }
    if (variaveisFaltando.includes('DEST_PHONE')) {
      console.error("   DEST_PHONE = +5511999999999 (seu WhatsApp)");
    }
    
    console.error("\n4. Salve e faça redeploy do projeto");
    console.error("\n⏳ Aguardando por 30 segundos antes de tentar novamente...");
    
    // Aguarda 30 segundos antes de tentar novamente (em vez de sair)
    setTimeout(() => {
      console.log("🔄 Tentando novamente...");
      validarVariaveisAmbiente();
    }, 30000);
    
    return false; // Indica que a validação falhou
  }

  console.log("✅ Todas as variáveis de ambiente estão definidas\n");
  return true; // Indica que a validação passou
}

// Executa a validação antes de iniciar
validarVariaveisAmbiente();

// Verifica a cada intervalo definido (padrão: 1 minuto)
const intervalo = parseInt(process.env.INTERVALO) || 60000;
console.log(`⏱️ Iniciando verificação de e-mails a cada ${intervalo / 1000} segundos...`);

// Executa imediatamente ao iniciar
verificarEmail();

// Configura o intervalo
setInterval(verificarEmail, intervalo);