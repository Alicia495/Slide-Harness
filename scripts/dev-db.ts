import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dir = path.join(process.cwd(), ".data", "dev-postgres");
await mkdir(dir, { recursive: true });
const database = await PGlite.create(dir);
const server = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 54321 });
await server.start();
console.log("Development PostgreSQL-compatible server: 127.0.0.1:54321");
async function stop() { await server.stop(); await database.close(); process.exit(0); }
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
