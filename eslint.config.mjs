import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // .worktrees 下每个分支是一份完整副本，扫进去会让 lint 从几十秒变成分钟级；
    // .tmp 与构建产物同理，只检查仓库自身源码。
    ignores: [
      "**/src-tauri/target",
      "**/src-tauri/gen",
      "**/.worktrees/**",
      "**/.tmp/**",
      "**/.next/**",
      "**/.next-smoke/**",
    ],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
