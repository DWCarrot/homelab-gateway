import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import Inspect from "vite-plugin-inspect";

// https://vite.dev/config/
export default defineConfig({
    base: "/transfer",
    plugins: [
        Inspect(),
        vue(),
    ],
    server: {
        proxy: {
            "/signaling": {
                target: "http://rockpi.homelab",
                changeOrigin: true,
                auth: "",
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    "vue-vendor": ["vue"], 
                    "antd-vendor": ["ant-design-vue", "@ant-design/icons-vue"],
                    "uuid-vendor": ["uuid"],
                },
            },
        }
    }
});
