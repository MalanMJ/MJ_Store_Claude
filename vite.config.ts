import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Inventory and image-source sheets must stay private even while using Vite's dev server.
  server: { fs: { deny: ["**/data/**"] } },
});
