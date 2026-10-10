import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendDir, "..");

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "ignore-chrome-devtools-json",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/.well-known/appspecific/com.chrome.devtools.json") {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Not Found" }));
            return;
          }
          next();
        });
      },
    },
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: "0.0.0.0",
    fs: {
      // Izinkan import todo.md dari root repo (mirror native di /docs)
      allow: [frontendDir, repoRoot],
    },
  },
});
