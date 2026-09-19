import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // react-hooks/purity and react-hooks/set-state-in-effect are new,
    // still-experimental rules (part of the React Compiler prep work) that
    // flag standard, working patterns in vendored shadcn/ui primitives
    // (sidebar.tsx, carousel.tsx, use-mobile.ts) — none of which were
    // authored in this project. Notably, the idiomatic fix for one of
    // these two rules (moving an impure read into an effect) directly
    // triggers the other, a known tension in this rule pair. Kept as
    // warnings rather than silenced entirely, and rather than risk
    // rewriting sidebar.tsx (used on every screen) to satisfy an
    // experimental rule for no functional benefit.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
