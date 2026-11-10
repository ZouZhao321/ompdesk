/**
 * 规则二的失真处理：改名、拆分、合并与替换式改动。
 *
 * 只看函数计数会在常规重构下给出错误结论：改名会让旧路径的基准对不上，一个文件拆成多个
 * 会让两侧函数总数同时变，删掉旧函数再加一个同类函数会让净增量为零。这里先用函数名集合
 * 把两侧文件逐个对应，再按对应结果决定规则二是照常判定、豁免，还是转人工。
 *
 * 五类情形：
 *
 * - 改名：git 已识别，基准取改名前的路径，不判失败；
 * - 改名未识别：改动幅度过大，git 记成删除加新增，按新增文件处理，走规则一；
 * - 分成多个 / 合为一个：函数名集合完整对应时豁免规则二；对应不完整时同样豁免，但退回
 *   行覆盖增量，由调用方拼判定；
 * - 替换：删除旧函数后新增函数且净增量为零，输出「疑似替换」，转人工豁免。
 *
 * 对应关系用连通分量算：两侧函数名集合的重叠比例达到阈值就连一条边，一个连通分量就是
 * 一组「原来这些东西，现在成了那些东西」。
 */

import type { FileCoverage } from "../lcov";

/** 两组函数名的最小重叠比例：交集除以较小的一侧。 */
const NAME_SET_OVERLAP_THRESHOLD = 0.35;

/** 名字集合与它所属的文件。 */
interface NamedSet {
  path: string;
  names: ReadonlySet<string>;
}

/** 一组互相迁移的文件。 */
interface NameSetGroup {
  basePaths: string[];
  headPaths: string[];
  /** 基准侧没有落到任何新文件里的名字。 */
  unmatchedBase: string[];
  /** 新文件里没有对应到任何旧文件的名字。 */
  unmatchedHead: string[];
  /** 两侧名字完全对上。 */
  complete: boolean;
}

/** 一行的失真处理说明，直接进报告。 */
export interface DistortionNote {
  /** 情形标签，报告行首显示。 */
  label: string;
  /** 涉及的文件；组的情形写成「旧 → 新」。 */
  file: string;
  /** 参与比较的数字与映射。 */
  numbers: string;
  /** 为什么这样处理。 */
  reason: string;
  /** 作者要做的事；无需动作时说明。 */
  fix: string;
}

/** 对应不完整时退回的行覆盖对照。 */
export interface LineFallback {
  /** 组的两侧路径，用于输出，形如「旧1、旧2 → 新1」。 */
  label: string;
  baseLinesHit: number;
  baseLinesFound: number;
  headLinesHit: number;
  headLinesFound: number;
}

/** 改名：git 已识别到旧路径。 */
interface RenameFact {
  path: string;
  previousPath: string;
  /** 旧路径在分叉点覆盖率里是否有记录。 */
  baseCovered: boolean;
}

/** 有删除函数的改动文件：两侧的函数名集合。 */
interface PersistentFact {
  path: string;
  basePath: string;
  baseNames: ReadonlySet<string>;
  headNames: ReadonlySet<string>;
}

/** 替换式改动：删了旧函数又加了新函数，净增量为零。 */
interface ReplacementFact {
  path: string;
  added: readonly string[];
  removed: readonly string[];
}

interface DistortionFacts {
  renames: readonly RenameFact[];
  /** 已从本次工作区消失、但在分叉点覆盖率里有记录的路径及其函数名。 */
  deleted: readonly NamedSet[];
  /** 本次新增的文件及其函数名。 */
  added: readonly NamedSet[];
  persistent: readonly PersistentFact[];
  replacements: readonly ReplacementFact[];
  baseCoverage: ReadonlyMap<string, FileCoverage>;
  coverage: ReadonlyMap<string, FileCoverage>;
}

interface DistortionResult {
  notes: DistortionNote[];
  /** 规则二免征的文件 → 免征原因。 */
  exemptions: Map<string, string>;
  /** 需要退回行覆盖增量的组。 */
  lineFallbacks: LineFallback[];
}

/** 交集除以较小的一侧；任一侧为空就没有重叠可言。 */
function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const name of left) if (right.has(name)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function unionNames(entries: readonly NamedSet[]): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) for (const name of entry.names) names.add(name);
  return names;
}

/**
 * 用函数名集合把两侧文件分组。两侧名字重叠达到阈值的文件连成一组；只有同时含基准侧与
 * 本次侧的分量才成组，输出按基准路径排序，供报告稳定复现。
 */
function groupByFunctionNames(base: readonly NamedSet[], head: readonly NamedSet[]): NameSetGroup[] {
  const parent = Array.from({ length: base.length + head.length }, (_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (const [baseIndex, baseEntry] of base.entries()) {
    for (const [headIndex, headEntry] of head.entries()) {
      if (overlapRatio(baseEntry.names, headEntry.names) >= NAME_SET_OVERLAP_THRESHOLD) {
        union(baseIndex, base.length + headIndex);
      }
    }
  }

  const groups = new Map<number, { base: NamedSet[]; head: NamedSet[] }>();
  const bucket = (root: number): { base: NamedSet[]; head: NamedSet[] } => {
    const existing = groups.get(root);
    if (existing) return existing;
    const created = { base: [] as NamedSet[], head: [] as NamedSet[] };
    groups.set(root, created);
    return created;
  };

  for (const [index, entry] of base.entries()) bucket(find(index)).base.push(entry);
  for (const [index, entry] of head.entries()) bucket(find(base.length + index)).head.push(entry);

  const result: NameSetGroup[] = [];
  for (const group of groups.values()) {
    if (group.base.length === 0 || group.head.length === 0) continue;
    group.base.sort((left, right) => left.path.localeCompare(right.path));
    group.head.sort((left, right) => left.path.localeCompare(right.path));
    const baseNames = unionNames(group.base);
    const headNames = unionNames(group.head);
    const unmatchedBase = [...baseNames].filter((name) => !headNames.has(name)).sort();
    const unmatchedHead = [...headNames].filter((name) => !baseNames.has(name)).sort();
    result.push({
      basePaths: group.base.map((entry) => entry.path),
      headPaths: group.head.map((entry) => entry.path),
      unmatchedBase,
      unmatchedHead,
      complete: unmatchedBase.length === 0 && unmatchedHead.length === 0,
    });
  }

  return result.sort((left, right) => left.basePaths[0].localeCompare(right.basePaths[0]));
}

function renameNotes(facts: DistortionFacts): DistortionNote[] {
  return facts.renames.map(
    (rename): DistortionNote => ({
      label: "改名",
      file: `${rename.path} ← ${rename.previousPath}`,
      numbers: rename.baseCovered ? "基准取改名前的路径" : "基准路径未出现在分叉点覆盖率里",
      reason: rename.baseCovered
        ? "git 识别为改名，旧路径的基准映射到新路径，不按新增文件处理"
        : "git 识别为改名，但旧路径在分叉点没有覆盖率记录，基准侧按 0 计",
      fix: rename.baseCovered
        ? "无需处理；两侧数字来自同一条基准记录"
        : "确认改名前该文件是否被测试加载，必要时为它补一个会加载的测试",
    }),
  );
}

function replacementNotes(facts: DistortionFacts): DistortionNote[] {
  return facts.replacements.map(
    (replacement): DistortionNote => ({
      label: "疑似替换",
      file: replacement.path,
      numbers: `删除 ${replacement.removed.length} 个函数，新增 ${replacement.added.length} 个，净增量 0`,
      reason: `删除旧函数后新增同类函数：删 ${replacement.removed.join("、")}，加 ${replacement.added.join("、")}，函数总数没有变化，函数增量判定不可靠`,
      fix: "转人工豁免：在评审里写明替换原因与替代验证方式",
    }),
  );
}

function sumLines(
  paths: readonly string[],
  coverage: ReadonlyMap<string, FileCoverage>,
): { hit: number; found: number } {
  let hit = 0;
  let found = 0;
  for (const path of paths) {
    const metrics = coverage.get(path);
    if (!metrics) continue;
    hit += metrics.linesHit;
    found += metrics.linesFound;
  }
  return { hit, found };
}

function groupFileLabel(group: NameSetGroup): string {
  return `${group.basePaths.join("、")} → ${group.headPaths.join("、")}`;
}

function groupNote(group: NameSetGroup, split: boolean): DistortionNote {
  const mapping = `基准 ${group.basePaths.join("、")} → 本次 ${group.headPaths.join("、")}`;
  if (group.complete) {
    return {
      label: split ? "文件分成多个" : "多个文件合为一个",
      file: groupFileLabel(group),
      numbers: `${mapping}，函数名集合完整对应`,
      reason: "用函数名集合逐个对应后两侧一致，函数增量判定不可靠，规则二豁免",
      fix: "无需处理；对应的函数名已在两侧出现",
    };
  }
  return {
    label: split ? "文件分成多个" : "多个文件合为一个",
    file: groupFileLabel(group),
    numbers: `${mapping}，未对应的旧函数 ${group.unmatchedBase.length} 个、新函数 ${group.unmatchedHead.length} 个`,
    reason: "函数名集合对应不完整，规则二豁免，退回行覆盖增量判定",
    fix: "为拆分后新增的行补测试，或在豁免清单登记替代验证方式",
  };
}

/**
 * 分析结构改造，给出说明、免征清单与退回行覆盖增量的组。纯函数：结论只取决于传入的
 * 事实，测试用固定样本，不读真实仓库。
 */
export function analyzeDistortion(facts: DistortionFacts): DistortionResult {
  const notes = [...renameNotes(facts), ...replacementNotes(facts)];
  const exemptions = new Map<string, string>();
  const lineFallbacks: LineFallback[] = [];

  for (const replacement of facts.replacements) {
    exemptions.set(replacement.path, "疑似替换（删除旧函数后新增函数，净增量为零），转人工豁免");
  }

  const baseEntries: NamedSet[] = [
    ...facts.deleted,
    ...facts.persistent.map((entry) => ({ path: entry.basePath, names: entry.baseNames })),
  ];
  const headEntries: NamedSet[] = [
    ...facts.added,
    ...facts.persistent.map((entry) => ({ path: entry.path, names: entry.headNames })),
  ];

  for (const group of groupByFunctionNames(baseEntries, headEntries)) {
    const oneToOne = group.basePaths.length === 1 && group.headPaths.length === 1;
    if (oneToOne) {
      // 1:1 且新路径是新增文件的，说明 git 没有识别出改名：按新增文件处理，走规则一。
      const [headPath] = group.headPaths;
      const isAdded = facts.added.some((entry) => entry.path === headPath);
      if (isAdded) {
        const headEntry = facts.added.find((entry) => entry.path === headPath);
        const shared = (headEntry?.names.size ?? 0) - group.unmatchedHead.length;
        notes.push({
          label: "改名未识别",
          file: `${group.basePaths[0]} → ${headPath}`,
          numbers: `两侧重名的函数 ${shared} 个，未落到新文件的旧函数 ${group.unmatchedBase.length} 个`,
          reason: "改动幅度过大，git 未把这次改动识别为改名，按新增文件处理，走规则一",
          fix: "为新增文件里的函数补测试；它按新增文件接受规则一判定",
        });
      }
      continue;
    }

    const split = group.headPaths.length > 1;
    notes.push(groupNote(group, split));
    const reason = split
      ? `文件分成多个，${group.complete ? "函数名集合完整对应" : "函数名集合对应不完整，退回行覆盖增量"}`
      : `多个文件合为一个，${group.complete ? "函数名集合完整对应" : "函数名集合对应不完整，退回行覆盖增量"}`;
    for (const headPath of group.headPaths) exemptions.set(headPath, reason);
    if (group.complete) continue;

    const base = sumLines(group.basePaths, facts.baseCoverage);
    const head = sumLines(group.headPaths, facts.coverage);
    lineFallbacks.push({
      label: groupFileLabel(group),
      baseLinesHit: base.hit,
      baseLinesFound: base.found,
      headLinesHit: head.hit,
      headLinesFound: head.found,
    });
  }

  return { notes, exemptions, lineFallbacks };
}
