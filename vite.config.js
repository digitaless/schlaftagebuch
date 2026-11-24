import { defineConfig } from "vite";
import Sitemap from "vite-plugin-sitemap";

export default defineConfig({
  // Relative base, damit die App unter jedem GitHub-Pages-Unterpfad läuft
  base: "./",
  plugins: [Sitemap({ hostname: "https://schlaftagebuch.ch" })],
  build: {
    rolldownOptions: {
      input: {
        app: "index.html",
        privacy: "privacy/index.html",
      },
    },
  },
});
