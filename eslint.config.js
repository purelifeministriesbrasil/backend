import tseslint from "typescript-eslint";

const LAYER_IMPORT_BAN = ["drizzle-orm*", "postgres", "@neondatabase/*", "resend", "hono*", "cloudflare:*"];

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "drizzle/**", ".wrangler/**", "scripts/**", "tests/**"],
  },
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.object.name='import'][property.name=/^SECRET_|^PRIVATE_/]",
          message: "Segredos só podem ser lidos via objeto env injetado no handler do Worker (§2.2).",
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Proibido ler process.env diretamente. Use o objeto env injetado pelo Worker (§2.2).",
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Use crypto.getRandomValues/randomUUID: identificadores precisam de CSPRNG.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/domains/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...LAYER_IMPORT_BAN, "**/application/**", "**/infrastructure/**", "**/presentation/**"],
              message: "Camada domains/ só pode importar TypeScript puro e Zod (§2.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...LAYER_IMPORT_BAN, "**/infrastructure/**", "**/presentation/**"],
              message: "Camada application/ nunca importa Drizzle, SDKs, ambiente ou infraestrutura (§2.1).",
            },
          ],
        },
      ],
    },
  }
);
