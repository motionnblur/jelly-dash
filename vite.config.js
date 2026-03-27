import { defineConfig } from "vite";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { normalizePath } from "vite";

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

            // Invalidate the module in Vite's graph so the next page reload
            // re-reads the file from disk instead of serving a cached version.
            const normalizedPath = normalizePath(filePath);
            const mods = server.moduleGraph.getModulesByFile(normalizedPath);
            if (mods) {
              for (const mod of mods) {
                server.moduleGraph.invalidateModule(mod);
              }
            }

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
