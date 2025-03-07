require("dotenv").config();
const axios = require("axios");
const cron = require("node-cron");
const express = require("express");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const FAILURE_THRESHOLD = process.env.FAILURE_THRESHOLD || 3;

// Variáveis de ambiente
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;
const CF_RECORD_NAME = process.env.CF_RECORD_NAME;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Lista de servidores monitorados
let servers = [];

// Função para listar servidores da Cloudflare
async function fetchServers() {
  try {
    console.log("🔄 Buscando registros DNS...");
    const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=${CF_RECORD_NAME}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });

    if (response.data.success) {
      servers = response.data.result.map((record) => ({
        name: record.name,
        ip: record.content,
        id: record.id,
        failures: 0,
      }));

      console.log("✅ Lista de servidores atualizada:", servers);
    } else {
      console.error("❌ Erro ao buscar registros DNS:", response.data.errors);
    }
  } catch (error) {
    console.error("❌ Erro na API do Cloudflare:", error.message);
  }
}

// Função para checar a saúde dos servidores
async function checkServer(server) {
  try {
    const url = `https://${server.name}/ping`;
    console.log(`🔎 Tentando acessar: ${url}`);
    const response = await axios.get(url, { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    console.error(`🚨 Serviço offline em ${server.name} (${server.ip}):`, error.message);
    return false;
  }
}

// Função para testar conexão com ping
async function pingServer(ip) {
  return new Promise((resolve) => {
    exec(`ping -c 2 ${ip}`, (error, stdout) => {
      if (error) {
        console.error(`❌ Máquina offline (${ip}):`, error.message);
        resolve(false);
      } else {
        console.log(`✅ Máquina online (${ip}):
${stdout}`);
        resolve(true);
      }
    });
  });
}

// Função para enviar alertas no Telegram
async function sendTelegramMessage(message) {
  try {
    const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(tgUrl, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    });
    console.log("📢 Mensagem enviada ao Telegram.");
  } catch (error) {
    console.error("❌ Erro enviando mensagem no Telegram:", error.message);
  }
}

// Função para remover um servidor da Cloudflare
async function removeServerFromDNS(record) {
  try {
    console.log(`🚨 Removendo servidor: ${record.ip}`);
    const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${record.id}`;
    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });

    if (response.data.success) {
      console.log(`✅ Servidor removido: ${record.ip}`);
    } else {
      console.error("❌ Erro ao remover registro DNS:", response.data.errors);
    }
  } catch (error) {
    console.error("❌ Erro ao remover servidor do DNS:", error.message);
  }
}

// Cron Job - Checagem a cada 1 minuto
cron.schedule("* * * * *", async () => {
  console.log("🔄 [CRON] Iniciando checagem de servidores...");
  
  if (servers.length === 0) {
    console.log("⚠️ Nenhum servidor na lista. Pulando checagem.");
    return;
  }

  console.log("📋 Lista de servidores monitorados:");
  servers.forEach(server => console.log(`   - ${server.name} (${server.ip}) | Falhas: ${server.failures}`));

  for (let server of servers) {
    console.log(`🔎 Verificando servidor: ${server.name} (${server.ip})...`);
    const serviceHealthy = await checkServer(server);

    if (!serviceHealthy) {
      console.log(`❌ Serviço inativo, testando máquina via ping...`);
      const machineOnline = await pingServer(server.ip);
      server.failures++;
      
      if (!machineOnline) {
        console.log(`🚨 Servidor ${server.ip} falhou ${server.failures} vez(es).`);

        if (server.failures >= FAILURE_THRESHOLD) {
          console.log(`🚨 Servidor ${server.ip} ultrapassou o limite de falhas (${FAILURE_THRESHOLD}). Removendo do balanceador...`);
          const message = `<b>Servidor Offline</b>\nIP: ${server.ip}\n\nRemovido do balanceador DNS. Favor revisar.`;
          await sendTelegramMessage(message);
          await removeServerFromDNS(server);
        }
      } else {
        console.log(`⚠️ Serviço fora, mas máquina responde ao ping (${server.ip}).`);
      }
    } else {
      console.log(`✅ Servidor ${server.ip} está online.`);
      server.failures = 0; // Resetando falhas se o servidor se recuperar
    }
  }
  console.log("✅ [CRON] Checagem concluída.");
});

// Cron Job - Atualização da Lista de Servidores a Cada 1 Hora
cron.schedule("0 * * * *", async () => {
  console.log("🔄 [CRON] Atualizando lista de servidores...");
  await fetchServers();
});

// Rota de saúde
app.get("/", (req, res) => {
  res.send("🚀 AI-Balancer rodando. Ver logs para status.");
});

// Iniciando o servidor
app.listen(PORT, () => {
  console.log(`📡 Servidor de monitoramento rodando na porta ${PORT}`);
  fetchServers(); // Inicializa a lista de servidores
});
