// @ts-check Let TS check this config file

import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "coverage/**",
      "dist/**",
      "logs/**",
      "node_modules/**",
      "scripts/**",
      ".references/**",
      ".scaffold/**",
      "**/*.js",
      "**/*.bak",
    ],
  },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
          "ts-check": "allow-with-description",
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": [
        "off",
        {
          ignoreRestArgs: true,
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { message: "Use `Zotero.getMainWindow()` instead.", name: "window" },
        {
          message: "Use `Zotero.getMainWindow().document` instead.",
          name: "document",
        },
        {
          message: "Use `Zotero.getActiveZoteroPane()` instead.",
          name: "ZoteroPane",
        },
        "Zotero_Tabs",
      ],
    },
  },
  eslintConfigPrettier,
);
