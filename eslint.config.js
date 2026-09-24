export default [
  {
    ignores: ["dist/**", "node_modules/**", "drizzle/**"],
  },
  {
    files: ["src/**/*.ts"],
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
      ],
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
              group: ["drizzle-orm*", "@neondatabase/*", "resend", "cloudflare:*"],
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
              group: ["drizzle-orm*", "@neondatabase/*", "resend", "cloudflare:*"],
              message: "Camada application/ nunca importa Drizzle, SDKs de base de dados ou ambiente (§2.1).",
            },
          ],
        },
      ],
    },
  },
];
