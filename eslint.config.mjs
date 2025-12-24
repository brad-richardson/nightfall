import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });
const tsProjects = [
  path.join(__dirname, "apps/api/tsconfig.json"),
  path.join(__dirname, "apps/ticker/tsconfig.json"),
  path.join(__dirname, "apps/web/tsconfig.json")
];
const nextConfigs = compat.extends("next/core-web-vitals").map((config) => ({
  ...config,
  files: ["apps/web/**/*.{js,jsx,ts,tsx}"]
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/.turbo/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextConfigs,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: tsProjects,
        tsconfigRootDir: __dirname
      }
    }
  }
);
