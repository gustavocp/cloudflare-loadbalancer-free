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
const CF_RECORD_NAME = process.env.CF_RECORD_NAME; // pipeline.ekz.com.br
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Monta o map DE-PARA do .env (ip -> serviço isolado, ex: pipeline2.ekz.com.br)
const serverMap = process.env.SERVER_MAP
  ? Object.fromEntries(
      process.env.SERVER_MAP.split(",").map((entry) => entry.split(":"))
    )
  : {};

// Lista de servidores (IPs) carregados da Cloudflare
let servers = [];

/**
 * Busca os registros DNS de pipeline.ekz.com.br (CF_RECORD_NAME) na Cloudflare,
 * preenchendo a lista 'servers' com ip, id, dominio isolado etc.
 */
async function fetchServers() {
  try {
    console.log("🔄 Buscando registros DNS...");
    const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=${CF_RECORD_NAME}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });

    if (response.data.success) {
      servers = response.data.result.map((record) => {
        const ip = record.content;
        return {
          ip,
          id: record.id,
          // domínio isolado mapeado no .env, se não existir, fica desconhecido
          isoDomain: serverMap[ip] || "desconhecido",
          failures: 0, // contador de falhas
        };
      });

      console.log("✅ Lista de servidores atualizada:", servers);
    } else {
      console.error("❌ Erro ao buscar registros DNS:", response.data.errors);
    }
  } catch (error) {
    console.error("❌ Erro na API do Cloudflare:", error.message);
  }
}

/**
 * Faz GET em https://dominio/ping para checar se serviço está online
 * Retorna true se status == 200, senão false.
 */
async function checkService(domain) {
  try {
    const url = `https://${domain}/ping`;
    console.log(`🔎 Tentando acessar serviço: ${url}`);
    const response = await axios.get(url, { timeout: 5000 });
    return response.status === 200;
  } catch (error) {
    console.error(`🚨 Serviço offline em ${domain}:`, error.message);
    return false;
  }
}

/**
 * Faz ping no IP para verificar se a máquina está online.
 * Retorna true se online, false caso contrário.
 */
async function pingServer(ip) {
  return new Promise((resolve) => {
    exec(`ping -c 2 ${ip}`, (error, stdout) => {
      if (error) {
        console.error(`❌ Máquina offline (${ip}):`, error.message);
        resolve(false);
      } else {
        console.log(`✅ Máquina online (${ip}):\n${stdout}`);
        resolve(true);
      }
    });
  });
}

/**
 * Envia mensagem de alerta no Telegram.
 */
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

/**
 * Remove o registro DNS de um servidor (IP) no Cloudflare.
 */
async function removeServerFromDNS(record) {
  try {
    console.log(`🚨 Removendo servidor (IP: ${record.ip}) do Cloudflare...`);
    const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${record.id}`;
    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    });

    if (response.data.success) {
      console.log(`✅ Servidor removido da Cloudflare: ${record.ip}`);

      // >>>>>> REMOVE O SERVIDOR DA LISTA LOCAL <<<<<<
      servers = servers.filter((s) => s.ip !== record.ip);
      console.log(`✅ IP ${record.ip} removido da lista local de servidores`);

    } else {
      console.error("❌ Erro ao remover registro DNS:", response.data.errors);
    }
  } catch (error) {
    console.error("❌ Erro ao remover servidor do DNS:", error.message);
  }
}


/**
 * CRON - Checagem de 1 em 1 minuto
 */
cron.schedule("* * * * *", async () => {
  console.log("🔄 [CRON] Iniciando checagem de servidores...");

  if (servers.length === 0) {
    console.log("⚠️ Nenhum servidor na lista. Pulando checagem.");
    return;
  }

  console.log("📋 Lista de servidores monitorados:");
  servers.forEach((s) =>
    console.log(
      `   - IP: ${s.ip} / isoDomain: ${s.isoDomain} / Falhas: ${s.failures}`
    )
  );

  for (let server of servers) {
    console.log(`🔎 Verificando IP: ${server.ip} ...`);

    // 1) Checa o serviço principal (pipeline.ekz.com.br)
    const mainOk = await checkService(CF_RECORD_NAME);

    // 2) Checa o serviço isolado (ex.: pipeline2.ekz.com.br, pipeline3.ekz.com.br)
    let isoOk = true;
    if (server.isoDomain !== "desconhecido") {
      isoOk = await checkService(server.isoDomain);
    }

    // Se qualquer um dos serviços (principal ou isolado) estiver offline => faz ping
    if (!mainOk || !isoOk) {
      console.log(`❌ Falha em algum serviço, testando ping na máquina: ${server.ip}`);
      const machineOnline = await pingServer(server.ip);

      // Incrementa falhas
      server.failures++;

      // Monta msg de status
      const offlineServices = [];
      if (!mainOk) offlineServices.push(CF_RECORD_NAME);
      if (!isoOk) offlineServices.push(server.isoDomain);
      const machineStatusMsg = machineOnline ? "Máquina online" : "Máquina offline";

      // Log
      console.log(`🚨 [Offline Services]: ${offlineServices.join(", ")} | ${machineStatusMsg}`);
      console.log(`🚨 Servidor ${server.ip} - falhas acumuladas: ${server.failures}`);

      // Se a máquina também estiver offline ou se quisermos remover ao atingir threshold
      if (server.failures >= FAILURE_THRESHOLD) {
        console.log(
          `🚨 Servidor (IP: ${server.ip}) ultrapassou o limite de falhas (${FAILURE_THRESHOLD}). Removendo...`
        );

        // Mensagem Telegram
        const message = `<b>Servidor Offline</b>\n\nIP: ${server.ip}\nServiços com falha: ${offlineServices.join(
          ", "
        )}\n${machineStatusMsg}\n\nRemovido do balanceador DNS. Favor revisar.`;

        await sendTelegramMessage(message);
        await removeServerFromDNS(server);
      }
    } else {
      // Tudo ok => reseta falhas
      console.log(
        `✅ Todos os serviços (principal e isolado) OK para IP: ${server.ip}. Resetando falhas...`
      );
      server.failures = 0;
    }
  }

  console.log("✅ [CRON] Checagem concluída.");
});

/**
 * CRON - Atualiza lista de servidores a cada 1 hora
 */
cron.schedule("0 * * * *", async () => {
  console.log("🔄 [CRON] Atualizando lista de servidores...");
  await fetchServers();
});

/**
 * Rota de saúde
 */
app.get("/", (req, res) => {
  res.send("🚀 AI-Balancer rodando. Ver logs para status.");
});

/**
 * Inicializa o servidor e carrega a lista de IPs da Cloudflare
 */
app.listen(PORT, () => {
  console.log(`📡 Servidor de monitoramento rodando na porta ${PORT}`);
  fetchServers();
});
