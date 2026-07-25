import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/auth": "http://localhost:4000",
      "/jobs": "http://localhost:4000",
      "/ai": "http://localhost:4000",
      "/exports": "http://localhost:4000",
      "/resumes": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
