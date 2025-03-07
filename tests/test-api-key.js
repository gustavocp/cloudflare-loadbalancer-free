
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
