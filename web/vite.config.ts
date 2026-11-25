import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 构建产物在 dist/，Dockerfile 第二阶段直接拷进 nginx
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
    // 本地开发：/api 代理到本机跑的 Node 服务，避免跨域
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5180",
        changeOrigin: true,
      },
    },
  },
});
