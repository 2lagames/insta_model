import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/media": "http://127.0.0.1:4317",
      "/input": "http://127.0.0.1:4317"
    }
  },
  test: {
    globals: true,
    environment: "node"
  }
});
