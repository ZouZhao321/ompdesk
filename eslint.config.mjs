import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // .worktrees 下每个分支是一份完整副本，扫进去会让 lint 从几十秒变成分钟级；
    // .tmp 与构建产物同理，只检查仓库自身源码。
    ignores: ["**/.worktrees/**", "**/.tmp/**", "**/.next/**", "**/.next-smoke/**"],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // 放在最后：关闭与 Prettier 重叠的排版规则，前面的检查规则不受影响。
  prettierConfig,
];

export default eslintConfig;
