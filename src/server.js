require('dotenv').config({ quiet: true });
const { openDatabase } = require('./db');
const { createApp } = require('./app');
async function main() {
  const db = await openDatabase(process.env.DATABASE_URL);
  const port = Number(process.env.PORT || 3000);
  const server = createApp(db).listen(port, '0.0.0.0', () => console.log(`FindYourJob is listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    server.close(async () => { await db.close(); process.exit(0); });
  });
}
main().catch(err => { console.error('Startup failed:', err.message); process.exitCode = 1; });
