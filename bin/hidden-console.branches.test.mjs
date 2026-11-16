/**
 * `bin/hidden-console.js` 的分支判定：哪些情况不能碰进程已有的控制台。
 *
 * 真实窗口枚举的验证在 `bin/hidden-console.test.mjs` 里；这一份用替身覆盖每条分支，两者
 * 分工不同：那边证明用户症状修好了，这边锁定「不要动前台实例的控制台」这类约定。
 *
 * 平台与运行时都由参数注入，所以这些用例与宿主平台无关，在 Linux 的持续集成上同样会跑。
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { ensureHiddenConsole } = require("./hidden-console.js");

/** 调用入口：默认按 Windows + Bun 注入，用例只覆盖自己关心的那个变量。 */
function onWindows(fake) {
  return ensureHiddenConsole({ platform: "win32", isBun: true, ffi: fake.ffi });
}

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
  const fake = fakeFfi();
  assert.equal(ensureHiddenConsole({ platform: "linux", isBun: true, ffi: fake.ffi }), false);
  assert.deepEqual(fake.libraries, [], "不该加载任何系统库");
});

test("非 Bun 运行时不做任何事", () => {
  const fake = fakeFfi();
  // `bun:ffi` 只有 Bun 提供；Node 下加载它会抛错，因此必须先按运行时判定。
  assert.equal(ensureHiddenConsole({ platform: "win32", isBun: false, ffi: fake.ffi }), false);
  assert.deepEqual(fake.libraries, [], "不该加载任何系统库");
});

test("进程已有控制台时不动它", () => {
  const fake = fakeFfi({ initialWindows: 1234 });

  // 前台实例与终端共用控制台：子进程要留在同一组里，Ctrl+C 与关闭终端才送得到。
  assert.equal(onWindows(fake), false);
  assert.deepEqual(fake.shown, [], "已有控制台时不得隐藏或改动它");
  assert.deepEqual(fake.libraries, ["kernel32.dll"], "只该读一次内核态，不该加载 user32");
});

test("分配失败时按原状继续", () => {
  const fake = fakeFfi({ allocateSucceeds: false });

  // 没有控制台只是会弹窗，不该让服务起不来。
  assert.equal(onWindows(fake), false);
  assert.deepEqual(fake.shown, [], "没分配成功就没有窗口可隐藏");
});

test("分配成功后把窗口隐藏起来", () => {
  const fake = fakeFfi();

  assert.equal(onWindows(fake), true);
  assert.deepEqual(fake.shown, [[4321, 0]], "分配之后必须用 SW_HIDE 把窗口藏起来");
});

test("第二次调用是空操作", () => {
  const fake = fakeFfi();

  assert.equal(onWindows(fake), true);
  assert.equal(onWindows(fake), false, "已经有控制台时不得再分配第二个");
  assert.deepEqual(fake.shown, [[4321, 0]], "只能隐藏一次");
});

test("分配后拿不到句柄时不隐藏", () => {
  // 句柄为 0 表示分配没有真正生效：没有窗口可隐藏，也不该把 0 传给 ShowWindow。
  const shown = [];
  const ffi = {
    FFIType: { i32: "i32", ptr: "ptr" },
    dlopen(name) {
      if (name === "kernel32.dll") {
        return { symbols: { GetConsoleWindow: () => 0, AllocConsole: () => 1 } };
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

  assert.equal(ensureHiddenConsole({ platform: "win32", isBun: true, ffi }), false);
  assert.deepEqual(shown, [], "拿不到句柄时不该调用 ShowWindow");
});
