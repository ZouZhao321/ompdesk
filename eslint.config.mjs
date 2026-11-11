import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // .worktrees 下每个分支是一份完整副本，扫进去会让 lint 从几十秒变成分钟级；
    // .tmp 与构建产物同理，只检查仓库自身源码。
    ignores: ["**/.worktrees/**", "**/.tmp/**", "**/.next*/**"],
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // 关闭与 Prettier 冲突的格式类规则，必须放在最后。
  prettier,
];

export default eslintConfig;
