const { createPool, migrate } = require('./db');
const { createApp } = require('./app');

async function main() {
  const pool = createPool();
  await migrate(pool, { advisoryLock: true });
  const port = Number(process.env.PORT) || 3000;
  const app = createApp({ pool });
  const server = app.listen(port, () => console.log(`Listening on ${port}`));
  const onExit = () => {
    server.close();
    app.locals.clicks.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', onExit);
  process.on('SIGINT', onExit);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
