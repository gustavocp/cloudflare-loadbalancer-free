import Cloudflare from 'cloudflare';

const client = new Cloudflare({
  apiEmail: 'gustavo@ekz.com.br', // This is the default and can be omitted
  apiKey: 'l6w6fBz72XIEejXjOMRvO-G9DxP4PKJ-01uG00IG', // This is the default and can be omitted
});

async function main() {
  const zone = await client.zones.create({
    account: { id: '023e105f4ecef8ad9ca31a8372d0c353' },
    name: 'ekz2.com.br',
    type: 'full',
  });

  console.log(zone.id);
}

main();