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
        emptyOutDir: true,
        cssCodeSplit: false,
        lib: {
            entry: path.resolve(__dirname, "src/mount.tsx"),
            name: "KaravanMapperLib",
            formats: ["iife"],
            fileName: () => "karavan-mapper.js",
        },
        rollupOptions: {
            external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
            output: {
                assetFileNames: "karavan-mapper.[ext]",
                globals: {
                    react: "React",
                    "react-dom": "ReactDOM",
                    "react-dom/client": "ReactDOMClient",
                    "react/jsx-runtime": "jsxRuntime",
                },
            },
        },
    },
});
