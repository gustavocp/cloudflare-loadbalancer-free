# Cloudflare Free Load Balancer

Este projeto é um sistema de monitoramento de servidores baseado em Node.js. Ele verifica a saúde dos servidores registrados na Cloudflare, enviando alertas via Telegram caso um servidor esteja offline e removendo-o do balanceador de carga automaticamente.

## 🚀 Como rodar o projeto

### 1️⃣ Clonar o repositório
```sh
git clone https://github.com/seu-usuario/seu-repositorio.git
cd seu-repositorio
```

### 2️⃣ Instalar as dependências
```sh
npm install
```

### 3️⃣ Criar um arquivo `.env`
Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis de ambiente:
```ini
PORT=3000
FAILURE_THRESHOLD=3

# Cloudflare
CF_API_TOKEN=sua_chave_api_cloudflare
CF_ZONE_ID=seu_zone_id
CF_RECORD_NAME=seu_dominio

# Telegram
TELEGRAM_BOT_TOKEN=seu_token_bot_telegram
TELEGRAM_CHAT_ID=seu_chat_id_telegram
```

### 4️⃣ Rodar o projeto
```sh
node index.js
```

## 🔄 Como funciona
- A cada **1 minuto**, o sistema verifica os servidores cadastrados na Cloudflare.
- Se um servidor estiver **offline**, ele faz um **ping** para verificar se a máquina responde.
- Caso o servidor falhe **3 vezes consecutivas**, ele é removido da Cloudflare e um alerta é enviado via Telegram.
- A cada **1 hora**, a lista de servidores é atualizada a partir da Cloudflare.

## 📡 Rotas disponíveis
| Método | Rota  | Descrição |
|--------|------|-------------|
| GET    | `/`  | Verifica se o AI-Balancer está rodando |

## 🛠 Tecnologias usadas
- Node.js
- Express.js
- Axios
- Node-Cron

## 📢 Contribuições
Sinta-se à vontade para contribuir abrindo issues ou pull requests! 😃

