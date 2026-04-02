import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  globalIgnores([
    // Next.js build artifacts
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party / generated directories not part of this project
    ".agent_venv/**",
    "bin/**",
    "node_modules/**",
    "public/**",
    "data/**",
    "screenshots/**",
    "output/**",
    "skills/**",
  ]),
]);

export default eslintConfig;
