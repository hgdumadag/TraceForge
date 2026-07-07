import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.TRACEFORGE_PORT ?? 4823);
// Local-first: bind to localhost only. Remote access requires explicit
// configuration AND is expected to sit behind TLS + auth (project.md §8.4).
const HOST = process.env.TRACEFORGE_HOST ?? "127.0.0.1";

const webDistCandidates = [
  join(here, "../../web/dist"), // dist layout: apps/api/dist -> apps/web/dist
  join(here, "../../../web/dist")
];

const { app } = await buildApp({
  webDist: webDistCandidates.find((c) => existsSync(c)) ?? webDistCandidates[0]
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    console.log(`TraceForge is running at http://${HOST}:${PORT}`);
    if (HOST !== "127.0.0.1" && HOST !== "localhost") {
      console.warn("WARNING: TraceForge is bound to a non-localhost address. Ensure TLS and authentication are in place.");
    }
  })
  .catch((err) => {
    console.error("Failed to start TraceForge:", err);
    process.exit(1);
  });
