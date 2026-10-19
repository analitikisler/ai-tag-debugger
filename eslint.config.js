// Catches real mistakes (undefined names, unused imports, unreachable code), not style:
// only the recommended rules, for ES modules on Node 20. Browser globals are on too,
// because the page scripts in src/browser.js and examples/demo-shop run inside Chromium.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: [".claude/", "node_modules/", "reports/", "aitd/", "saved/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
    rules: {
      // An argument named _x is unused on purpose, a caught error is often not needed, and
      // `const { dropped, ...rest } = obj` names a field only to leave it out.
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
  // The demo shop's page script is a classic script that uses the gtag snippet its HTML defines inline.
  { files: ["examples/demo-shop/*.js"], languageOptions: { sourceType: "script", globals: { dataLayer: "readonly", gtag: "readonly" } } },
];
