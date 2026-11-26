import { homedir } from "node:os";
import { createBoard } from "./board.ts";
import { configFromEnv } from "./config.ts";
import { startServer } from "./server.ts";

const config = configFromEnv(process.env, homedir());
const board = createBoard(config.board);
await startServer({ board, host: config.host, port: config.port, allowedHosts: config.allowedHosts });
await board.snapshot(Date.now());
console.log(`usage-board: http://${config.host}:${config.port}/`);
