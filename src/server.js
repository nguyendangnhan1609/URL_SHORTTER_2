const { createPool, migrate } = require('./db');
const { createApp } = require('./app');

async function main() {
  const pool = createPool();
  await migrate(pool);
  const port = Number(process.env.PORT) || 3000;
  createApp({ pool }).listen(port, () => console.log(`Listening on ${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
