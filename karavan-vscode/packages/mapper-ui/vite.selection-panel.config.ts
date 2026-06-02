import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
    define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
        dedupe: ["react", "react-dom", "react/jsx-runtime"],
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        outDir: path.resolve(__dirname, "../../dist/mapper"),
        emptyOutDir: false,
        cssCodeSplit: false,
        lib: {
            entry: path.resolve(__dirname, "src/selection-panel-main.tsx"),
            name: "KaravanMapperSelection",
            formats: ["iife"],
            fileName: () => "karavan-mapper-selection.js",
        },
        rollupOptions: {
            output: {
                assetFileNames: "karavan-mapper-selection.[ext]",
            },
        },
    },
});
