import { defineConfig } from "vite";
import { writeFileSync } from "fs";
import { resolve } from "path";

function levelSaverPlugin() {
  return {
    name: "level-saver",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || req.url !== "/api/save-level") {
          return next();
        }

        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const profile = JSON.parse(body);
            const filePath = resolve("assets/levels", `level${profile.level}.json`);
            writeFileSync(filePath, JSON.stringify(profile, null, 2));
            res.setHeader("Content-Type", "application/json");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            res.setHeader("Content-Type", "application/json");
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [levelSaverPlugin()],
  server: {
    watch: {
      ignored: ["**/assets/levels/**"],
    },
  },
});
