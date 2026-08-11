import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
  },
});
