import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://<user>.github.io/webgames/ — relative base also lets the build run from any folder.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1800, // Phaser is ~1.2 MB minified and only loads when a game opens
  },
});
