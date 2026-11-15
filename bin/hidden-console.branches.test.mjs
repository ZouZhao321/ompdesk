/**
 * `bin/hidden-console.js` 的分支判定：哪些情况不能碰进程已有的控制台。
 *
 * 真实窗口枚举的验证在 `bin/hidden-console.test.mjs` 里；这一份用替身覆盖每条分支，两者
 * 分工不同：那边证明用户症状修好了，这边锁定「不要动前台实例的控制台」这条约定。
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { ensureHiddenConsole } = require("./hidden-console.js");

/** FFI 替身：`windows` 记录内核态看到的控制台窗口句柄，`shown` 记录 ShowWindow 的调用。 */
function fakeFfi({ initialWindows = 0, allocateSucceeds = true } = {}) {
  let windows = initialWindows;
  const shown = [];
  const libraries = [];

  const ffi = {
    FFIType: { i32: "i32", ptr: "ptr" },
    dlopen(name) {
      libraries.push(name);
      if (name === "kernel32.dll") {
        return {
          symbols: {
            GetConsoleWindow: () => windows,
            AllocConsole: () => {
              if (!allocateSucceeds) return 0;
              windows = 4321;
              return 1;
            },
          },
        };
      }
      return {
        symbols: {
          ShowWindow: (handle, command) => {
            shown.push([Number(handle), command]);
            return 1;
          },
        },
      };
    },
  };

  return { ffi, shown, libraries };
}

test("非 Windows 平台不做任何事", () => {
  const { ffi, libraries } = fakeFfi();
  assert.equal(ensureHiddenConsole({ platform: "linux", ffi }), false);
  assert.deepEqual(libraries, [], "不该加载任何系统库");
});

test("进程已有控制台时不动它", { skip: process.platform === "win32" ? false : "只在 Windows 上走这条分支" }, () => {
  const { ffi, shown, libraries } = fakeFfi({ initialWindows: 1234 });

  // 前台实例与终端共用控制台：子进程要留在同一组里，Ctrl+C 与关闭终端才送得到。
  assert.equal(ensureHiddenConsole({ platform: "win32", ffi }), false);
  assert.deepEqual(shown, [], "已有控制台时不得隐藏或改动它");
  assert.deepEqual(libraries, ["kernel32.dll"], "只该读一次内核态，不该加载 user32");
});

test("分配失败时按原状继续", { skip: process.platform === "win32" ? false : "只在 Windows 上走这条分支" }, () => {
  const { ffi, shown } = fakeFfi({ allocateSucceeds: false });

  // 没有控制台只是会弹窗，不该让服务起不来。
  assert.equal(ensureHiddenConsole({ platform: "win32", ffi }), false);
  assert.deepEqual(shown, [], "没分配成功就没有窗口可隐藏");
});

test("分配成功后把窗口隐藏起来", { skip: process.platform === "win32" ? false : "只在 Windows 上走这条分支" }, () => {
  const { ffi, shown } = fakeFfi();

  assert.equal(ensureHiddenConsole({ platform: "win32", ffi }), true);
  assert.deepEqual(shown, [[4321, 0]], "分配之后必须用 SW_HIDE 把窗口藏起来");
});
