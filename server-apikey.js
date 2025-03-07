require('dotenv').config();
const fetch = require("node-fetch");
const cron = require("node-cron");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;
const FAILURE_THRESHOLD = 3;

// Variáveis de ambiente (definidas no .env)
const CF_API_TOKEN = process.env.CF_API_TOKEN;        // Global API Key
const CF_ZONE_ID = process.env.CF_ZONE_ID;            // ID da sua zona no Cloudflare
const CF_RECORD_NAME = process.env.CF_RECORD_NAME;    // Nome do registro (ex.: pipeline.ekz.com.br)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Lista de servidores monitorados; cada objeto: { name, ip, id, failures }
let servers = [];

async function verifyCloudflareToken() {
    try {
        const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${CF_API_TOKEN}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "node-fetch/1.0"
            }
        });

        const data = await response.json();
        if (response.ok) {
            console.log("✅ Token de Cloudflare verificado com sucesso:", data);
        } else {
            console.error("❌ Falha na verificação do token de Cloudflare:", data);
        }
    } catch (error) {
        console.error("❌ Erro inesperado durante a verificação do token:", error.message);
    }
}

// Chame esta função na inicialização, por exemplo:
verifyCloudflareToken();



/**
 * Busca registros DNS (tipo A) para CF_RECORD_NAME na zona CF_ZONE_ID via API do Cloudflare.
 */
async function fetchServers() {
    try {
        const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=${CF_RECORD_NAME}`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${CF_API_TOKEN}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        });
        const data = await response.json();
        if (data.success) {
            servers = data.result.map(record => ({
                name: record.name,    // ex.: pipeline.ekz.com.br
                ip: record.content,   // IP do registro
                id: record.id,        // ID único do registro no Cloudflare
                failures: 0
            }));
            console.log("✅ Lista de servidores atualizada:", servers);
        } else {
            console.error("❌ Erro ao buscar registros DNS:", data.errors);
        }
    } catch (error) {
        console.error("❌ Erro ao buscar servidores:", error.message);
    }
}

/**
 * Checa a saúde do servidor chamando o endpoint /ping.
 * Ajuste o protocolo ou path se necessário.
 */
async function checkServer(server) {
    const url = `http://${server.ip}/ping`;
    try {
        const res = await fetch(url, { method: "GET", timeout: 5000 });
        return res.status === 200;
    } catch (error) {
        console.error(`❌ Erro ao acessar ${server.ip}/ping:`, error.message);
        return false;
    }
}

/**
 * Envia mensagem via Telegram.
 */
async function sendTelegramMessage(message) {
    try {
        const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(tgUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: "HTML"
            })
        });
        console.log("📢 Mensagem enviada ao Telegram.");
    } catch (error) {
        console.error("❌ Erro ao enviar mensagem ao Telegram:", error.message);
    }
}

/**
 * Remove o registro DNS no Cloudflare via DELETE.
 */
async function removeServerFromDNS(record) {
    try {
        const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${record.id}`;
        const response = await fetch(url, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${CF_API_TOKEN}` }
        });
        const data = await response.json();
        if (data.success) {
            console.log(`🗑️ Registro removido: ${record.name} (${record.ip})`);
        } else {
            console.error("❌ Erro ao remover registro DNS:", data.errors);
        }
    } catch (error) {
        console.error("❌ Erro ao remover servidor do DNS:", error.message);
    }
}

/**
 * Cron job: A cada 1 minuto, verifica a saúde de cada servidor.
 * Se um servidor falhar 3 vezes consecutivas, envia alerta via Telegram e remove o registro.
 */
cron.schedule('* * * * *', async () => {
    console.log("🔄 [CRON] Checando saúde dos servidores...");
    for (let server of servers) {
        const healthy = await checkServer(server);
        if (!healthy) {
            server.failures++;
            console.log(`⚠️ Servidor ${server.ip} falhou ${server.failures} vez(es).`);
            if (server.failures >= FAILURE_THRESHOLD) {
                const message = `<b>🚨 Servidor Offline</b>\nIP: ${server.ip}\nAI-Balancer removendo do pool de servidores.\n🔧 Favor verificar e reinserir este servidor no Cloudflare.`;
                await sendTelegramMessage(message);
                await removeServerFromDNS(server);
            }
        } else {
            if (server.failures > 0) {
                console.log(`✅ Servidor ${server.ip} voltou ao normal.`);
            }
            server.failures = 0;
        }
    }
});

/**
 * Cron job: A cada 1 hora, atualiza a lista de servidores via API do Cloudflare.
 */
cron.schedule('0 * * * *', async () => {
    console.log("⏳ [CRON] Atualizando lista de servidores...");
    await fetchServers();
});

/**
 * Endpoint simples para confirmar que o app está rodando.
 */
app.get('/', (req, res) => {
    res.send('🚀 AI-Balancer está rodando. Ver logs para detalhes.');
});

/**
 * Inicia o servidor Express.
 */
app.listen(PORT, () => {
    console.log(`📡 Servidor de monitoramento rodando na porta ${PORT}`);
});

/**
 * Inicializa a lista de servidores ao iniciar.
 */
fetchServers();
