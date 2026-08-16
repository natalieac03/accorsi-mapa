import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite do HARNESS VISUAL — descartável, nunca usado pelo build de produção
 * (o `npm run build` da raiz usa o vite.config.ts da raiz e não conhece este
 * arquivo). Os aliases trocam os snapshots reais por FIXTURES SINTÉTICAS
 * geradas por gerar-fixtures.mjs, para a janela Estatísticas ter o que
 * desenhar mesmo num checkout com placeholders "pendente".
 *
 * Uso:
 *   node scripts/dev/harness/gerar-fixtures.mjs
 *   npx vite --config scripts/dev/harness/vite.config.ts
 */
const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../../..");

export default defineConfig({
  root: aqui,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /.*\/data\/candidato\/adriana-accorsi\.json$/,
        replacement: resolve(aqui, "fixtures/adriana-accorsi.json"),
      },
      {
        find: /.*\/data\/electorate-go\.json$/,
        replacement: resolve(aqui, "fixtures/electorate-go.json"),
      },
      {
        find: /.*\/data\/age-structure-go\.json$/,
        replacement: resolve(aqui, "fixtures/age-structure-go.json"),
      },
      {
        find: /.*\/data\/literacy-go\.json$/,
        replacement: resolve(aqui, "fixtures/literacy-go.json"),
      },
      { find: "@src", replacement: resolve(raiz, "src") },
    ],
  },
  server: { host: "127.0.0.1", port: 5199 },
});
