import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
    base: "/transfer",
    plugins: [vue()],
    server: {
        proxy: {
            "/signaling": {
                target: "http://rockpi.homelab",
                changeOrigin: true,
                auth: "",
            }
        }
    }
});
