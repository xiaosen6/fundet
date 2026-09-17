import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CINDY_BRIDGE_EXTENSION_SOURCE } from '../cindy-bridge-source.js';

type ReviewSearchHelpers = {
  filterReviewGrepResult: (
    result: unknown,
    input: unknown,
    allowedPaths: string[],
  ) => { content: Array<{ text?: string }>; details?: unknown };
  reviewSearchPathIsVisible: (
    candidate: string,
    allowedPaths: string[],
    baseDir?: string,
  ) => boolean;
  rgGlob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]>;
};

function loadReviewSearchHelpers(
  workingDir: string,
  overrides: {
    lstatSync?: typeof lstatSync;
    managedRipgrepPath?: string;
  } = {},
): ReviewSearchHelpers {
  const source = CINDY_BRIDGE_EXTENSION_SOURCE;
  const helperStart = source.indexOf("function isInsideRoot");
  const helperEnd = source.indexOf("// ── MCP streamable-HTTP");
  const findStart = source.indexOf("function rgGlob(");
  const findEnd = source.indexOf("export default async function cindyBridge");
  if (
    helperStart < 0 ||
    helperEnd <= helperStart ||
    findStart < 0 ||
    findEnd <= findStart
  ) {
    throw new Error(
      "Review search helpers were not found in the generated bridge",
    );
  }
  const executableSource = [
    "const REVIEW_CREDENTIAL_PATH_PATTERNS: RegExp[] = [/(?:^|[\\\\/])node_modules(?:[\\\\/]|$)/i];",
    "const REVIEW_CREDENTIAL_GLOB_PATTERNS: string[] = [];",
    source.slice(helperStart, helperEnd),
    "function currentPermissionState() {",
    "  return { reviewOnly: true, reviewReadPaths: (globalThis as any).__reviewReadPaths };",
    "}",
    "function managedRipgrepPath() { return (globalThis as any).__managedRipgrepPath; }",
    source.slice(findStart, findEnd),
    "(globalThis as any).filterReviewGrepResult = filterReviewGrepResult;",
    "(globalThis as any).reviewSearchPathIsVisible = reviewSearchPathIsVisible;",
    "(globalThis as any).rgGlob = rgGlob;",
  ].join("\n");
  const compiled = ts.transpileModule(executableSource, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context: Partial<ReviewSearchHelpers> & Record<string, unknown> = {
    path,
    process: { cwd: () => workingDir, platform: process.platform },
    Buffer,
    lstatSync: overrides.lstatSync ?? lstatSync,
    readFileSync,
    realpathSync,
    statSync,
    spawn,
    createInterface,
    __reviewReadPaths: [workingDir],
    __managedRipgrepPath: overrides.managedRipgrepPath ?? "",
  };
  runInNewContext(compiled, context);
  if (
    !context.filterReviewGrepResult ||
    !context.reviewSearchPathIsVisible ||
    !context.rgGlob
  ) {
    throw new Error("Review search helpers were not loaded");
  }
  return context as ReviewSearchHelpers;
}

describe('cindy-bridge extension source', () => {
  // 托管 ripgrep 二进制不进 Git（tools/ripgrep/update.mjs 下载）；本机没有就跳过
  // 依赖它的用例，与 pi 集成测试的 skip 口径一致
  const managedRipgrepPath = path.resolve(
    process.cwd(),
    '..',
    '..',
    'apps',
    'ripgrep-bin',
    `${process.platform}-${process.arch}`,
    'rg',
  );
  const managedRipgrepAvailable = existsSync(managedRipgrepPath);

  it('is valid standalone TypeScript for the Pi runtime to load', () => {
    const result = ts.transpileModule(CINDY_BRIDGE_EXTENSION_SOURCE, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    });
    const errors = (result.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(errors).toEqual([]);
  });

  it('overrides find with the managed ripgrep backend instead of runtime fd download', () => {
    const source = CINDY_BRIDGE_EXTENSION_SOURCE;

    for (const tool of ['createBashTool', 'createFindTool', 'createGrepTool', 'createLsTool']) {
      expect(source).toContain(tool + ',');
    }
    expect(source).toContain("const args = ['--files', '--hidden', '--no-require-git']");
    expect(source).toContain("if (pattern.includes('/')) {");
    expect(source).toContain('path.basename(relative)');
    expect(source).toContain("effectivePattern = '**/' + pattern");
    expect(source).toContain('path.resolve(cwd, relative)');
    expect(source).toContain('path.matchesGlob(candidate, effectivePattern)');
    expect(source).not.toContain("'--glob', pattern");
    expect(source).toContain('glob: rgGlob');
    expect(source).toContain('const grepTool = createGrepTool(process.cwd())');
    expect(source).toContain(
      'filterReviewGrepResult(result, params, permission.reviewReadPaths)',
    );
    expect(source).toContain(
      'reviewSearchPathIsVisible(relative, permission.reviewReadPaths, cwd)',
    );
    expect(source).toContain('spawn(managedRipgrepPath(), args, {');
    expect(source).not.toContain("spawn('rg'");
    expect(source).toContain("const MANAGED_RG_PATH_ENV = 'CINDY_PI_MANAGED_RG_PATH'");
    expect(source).toContain('const lsTool = createLsTool(process.cwd())');
    expect(source).not.toContain("spawn('fd'");
  });

  it('keeps generated extension source free of template literals', () => {
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).not.toContain('`');
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).not.toContain('${');
  });

  it('captures known writes before execution and marks opaque tools only after a result', () => {
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain("pi.on('tool_call'");
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain('FILE_WRITE_BUILTINS.has(event.toolName)');
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain("pi.on('tool_result'");
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain("event.toolName !== 'bash'");
    expect(CINDY_BRIDGE_EXTENSION_SOURCE).toContain("startsWith('mcp__')");
  });

  it('forces confirmation for control-plane writes even under Full access (#4518)', () => {
    const source = CINDY_BRIDGE_EXTENSION_SOURCE;
    // 门序：extra-dirs 拦截 → 控制面判定 → bypass 放行必须带 controlPlaneWrite 例外
    const extraDirsGate = source.indexOf("'Cindy extra reference directories are read-only.'");
    const controlPlaneCompute = source.indexOf('const controlPlaneWrite = Boolean(');
    const bypassReturn = source.indexOf(
      "permission.mode === 'bypassPermissions' && !controlPlaneWrite",
    );
    expect(extraDirsGate).toBeGreaterThan(-1);
    expect(controlPlaneCompute).toBeGreaterThan(extraDirsGate);
    expect(bypassReturn).toBeGreaterThan(controlPlaneCompute);
    // 审批卡带控制面标记与规范路径证据
    expect(source).toContain('controlPlaneWrite: true, resolvedWritePath: writeTargetResolved');
    // 真实目标无法解析（悬空/循环链接）时非 bypass 档 fail closed
    expect(source).toContain("'Cindy could not verify the real file-write target.'");
  });

  it.skipIf(process.platform === 'win32')(
    'resolves write targets through symlinks and fails closed on dangling links',
    () => {
      const source = CINDY_BRIDGE_EXTENSION_SOURCE;
      const start = source.indexOf('function isInsideRoot');
      const end = source.indexOf('function reviewAncestorsWithin');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const executableSource = [
        source.slice(start, end),
        '(globalThis as any).resolveFileWriteTargetPath = resolveFileWriteTargetPath;',
        '(globalThis as any).isInsideRoot = isInsideRoot;',
      ].join('\n');
      const compiled = ts.transpileModule(executableSource, {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;

      const tempRoot = mkdtempSync(path.join(tmpdir(), 'cindy-pi-write-target-'));
      try {
        const agentHome = path.join(tempRoot, 'agent-home');
        const realDir = path.join(tempRoot, 'real-dir');
        mkdirSync(agentHome);
        mkdirSync(realDir);
        // agentHome 内的 link 指向外面：字面路径在控制面内，realpath 在外面
        const escapeLink = path.join(agentHome, 'escape');
        symlinkSync(realDir, escapeLink);
        // 悬空链接：目标不存在且自身是链接
        const dangling = path.join(realDir, 'dangling-link');
        symlinkSync(path.join(realDir, 'no-such-target'), dangling);

        const context: Record<string, unknown> = { path, realpathSync, lstatSync };
        runInNewContext(compiled, context);
        const resolve = context['resolveFileWriteTargetPath'] as (p: string) => string | null;
        const isInsideRoot = context['isInsideRoot'] as (c: string, r: string) => boolean;
        expect(resolve).toBeTypeOf('function');

        // 已存在文件 → 规范路径
        const existing = path.join(realDir, 'a.txt');
        writeFileSync(existing, 'x');
        expect(resolve(existing)).toBe(realpathSync(existing));
        // 新文件（不存在）→ 沿最近存在父目录解析
        expect(resolve(path.join(realDir, 'new.txt'))).toBe(
          path.join(realpathSync(realDir), 'new.txt'),
        );
        // 控制面内的符号链接目录 → 解析到根外（字面命中控制面，resolved 不命中）
        expect(isInsideRoot(escapeLink, agentHome)).toBe(true);
        expect(resolve(path.join(escapeLink, 'payload'))).toBe(
          path.join(realpathSync(realDir), 'payload'),
        );
        // 悬空链接 → null（fail closed）
        expect(resolve(dangling)).toBeNull();
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it('checks the Review deny-by-default boundary before ordinary permission handling', () => {
    const source = CINDY_BRIDGE_EXTENSION_SOURCE;
    const reviewGate = source.indexOf('if (permission.reviewOnly)');
    const ordinaryWriteHandling = source.indexOf('if (FILE_WRITE_BUILTINS.has(event.toolName))');

    expect(reviewGate).toBeGreaterThan(-1);
    expect(ordinaryWriteHandling).toBeGreaterThan(reviewGate);
    expect(source).toContain(
      "reason: 'Cindy Review only permits read-only access to this task and its explicit artifacts.'",
    );
    expect(source).toContain('normalizeReviewReadInput(');
    expect(source).toContain('collectReviewPathFields(input)');
    expect(source).toContain("new Set(['glob', 'globs', 'pattern', 'patterns'])");
    expect(source).toContain('reviewSelectorTouchesCredential(selector)');
    expect(source).toContain('resolveReviewReadPath(candidate, allowedPaths)');
    expect(source).toContain('(input as Record<string, unknown>).path = resolvedPaths[0]!');
    expect(source).toContain('pathFields[index].write(resolvedPaths[index]!)');
    expect(source).not.toContain("toolName === 'grep' && statSync(target).isDirectory()");
    expect(source).toContain('reviewFileLinkLayoutIsSafe(target, targetStat, allowed)');
    expect(source).toContain("candidates.add(path.join(dependencyRoot, 'node_modules'");
    expect(source).toContain('reviewSearchPathHasUnsafeLinkLayout');
    expect(source).toContain(
      'reviewSearchPathIsVisible(relative, permission.reviewReadPaths, cwd)',
    );
    expect(source).not.toContain('reviewSearchPathHasMultipleLinks');
    expect(source).toContain('REVIEW_CREDENTIAL_PATH_PATTERNS.some');
    expect(source).toContain('REVIEW_CREDENTIAL_GLOB_PATTERNS.some');
  });

  it.skipIf(process.platform === 'win32')(
    'pins every Pi read tool to the real path that passed Review validation',
    () => {
      const source = CINDY_BRIDGE_EXTENSION_SOURCE;
      const helperStart = source.indexOf('function isInsideRoot');
      const helperEnd = source.indexOf('function reviewSearchPathTouchesCredential');
      expect(helperStart).toBeGreaterThan(-1);
      expect(helperEnd).toBeGreaterThan(helperStart);

      const executableSource = [
        "const REVIEW_CREDENTIAL_PATH_PATTERNS: RegExp[] = [/(?:^|[\\\\/])node_modules(?:[\\\\/]|$)/i];",
        source.slice(helperStart, helperEnd),
        '(globalThis as any).normalizeReviewReadInput = normalizeReviewReadInput;',
      ].join('\n');
      const compiled = ts.transpileModule(executableSource, {
        compilerOptions: {
          module: ts.ModuleKind.None,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;

      const tempRoot = mkdtempSync(path.join(tmpdir(), 'cindy-pi-review-read-'));
      try {
        const workingDir = path.join(tempRoot, 'workspace');
        const outsideDir = path.join(tempRoot, 'outside');
        mkdirSync(workingDir);
        mkdirSync(outsideDir);
        const approvedPath = path.join(workingDir, 'approved.txt');
        const outsidePath = path.join(outsideDir, 'secret.txt');
        const linkPath = path.join(workingDir, 'review-input.txt');
        writeFileSync(approvedPath, 'approved');
        writeFileSync(outsidePath, 'outside');
        symlinkSync(approvedPath, linkPath);

        type NormalizeReviewReadInput = (
          toolName: string,
          input: unknown,
          allowedPaths: string[],
        ) => boolean;
        const context: {
          normalizeReviewReadInput?: NormalizeReviewReadInput;
        } & Record<string, unknown> = {
          path,
          process: { cwd: () => workingDir, platform: process.platform },
          Buffer,
          lstatSync,
          readFileSync,
          realpathSync,
          statSync,
        };
        runInNewContext(compiled, context);
        const normalizeReviewReadInput = context.normalizeReviewReadInput;
        expect(normalizeReviewReadInput).toBeTypeOf('function');
        if (!normalizeReviewReadInput) throw new Error('Review read normalizer was not loaded');

        const readInput = { path: linkPath };
        const grepInput = { request: { paths: [linkPath] }, pattern: 'approved' };
        const findInput = { options: { filePath: linkPath }, pattern: '*.txt' };
        const lsInput = { filepath: linkPath };
        const inputs = [
          { tool: 'read', input: readInput },
          {
            tool: 'grep',
            input: grepInput,
          },
          {
            tool: 'find',
            input: findInput,
          },
          { tool: 'ls', input: lsInput },
        ];
        for (const { tool, input } of inputs) {
          expect(normalizeReviewReadInput(tool, input, [approvedPath])).toBe(true);
        }

        expect(readInput.path).toBe(realpathSync(approvedPath));
        expect(grepInput.request.paths).toEqual([realpathSync(approvedPath)]);
        expect(findInput.options.filePath).toBe(realpathSync(approvedPath));
        expect(lsInput.filepath).toBe(realpathSync(approvedPath));

        for (const tool of ['read', 'grep', 'find', 'ls']) {
          const defaultInput: Record<string, unknown> = {};
          expect(normalizeReviewReadInput(tool, defaultInput, [workingDir])).toBe(true);
          expect(defaultInput.path).toBe(realpathSync(workingDir));
        }

        const localPackage = path.join(workingDir, 'packages', 'maker-core');
        const localSource = path.join(localPackage, 'src', 'index.ts');
        const localMirror = path.join(
          workingDir,
          'node_modules',
          '@cindy',
          'maker-core',
          'src',
          'index.ts',
        );
        mkdirSync(path.dirname(localSource), { recursive: true });
        mkdirSync(path.dirname(localMirror), { recursive: true });
        writeFileSync(
          path.join(localPackage, 'package.json'),
          '{"name":"@cindy/maker-core"}',
        );
        writeFileSync(localSource, 'export const value = 1;');
        linkSync(localSource, localMirror);
        expect(
          normalizeReviewReadInput('read', { path: localSource }, [workingDir]),
        ).toBe(true);

        const outsideManifest = path.join(outsideDir, 'package.json');
        const localManifest = path.join(localPackage, 'package.json');
        writeFileSync(outsideManifest, '{"name":"@cindy/maker-core"}');
        unlinkSync(localManifest);
        symlinkSync(outsideManifest, localManifest);
        expect(
          normalizeReviewReadInput('read', { path: localSource }, [workingDir]),
        ).toBe(false);
        unlinkSync(localManifest);
        writeFileSync(localManifest, '{"name":"@cindy/maker-core"}');

        linkSync(localSource, path.join(outsideDir, 'third-link.ts'));
        expect(
          normalizeReviewReadInput('read', { path: localSource }, [workingDir]),
        ).toBe(false);

        unlinkSync(linkPath);
        symlinkSync(outsidePath, linkPath);
        expect(readFileSync(readInput.path, 'utf8')).toBe('approved');
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32" || !managedRipgrepAvailable)(
    "keeps safe pnpm links visible to Pi Grep and managed Find while rejecting unsafe layouts",
    async () => {
      const tempRoot = mkdtempSync(
        path.join(tmpdir(), "cindy-pi-review-search-"),
      );
      try {
        const workingDir = path.join(tempRoot, "workspace");
        const outsideDir = path.join(tempRoot, "outside");
        mkdirSync(workingDir);
        mkdirSync(outsideDir);

        const sourcePackage = path.join(
          workingDir,
          "packages",
          "maker-core",
        );
        const sourcePath = path.join(sourcePackage, "src", "index.ts");
        const mirrorPath = path.join(
          workingDir,
          "node_modules",
          "@cindy",
          "maker-core",
          "src",
          "index.ts",
        );
        mkdirSync(path.dirname(sourcePath), { recursive: true });
        mkdirSync(path.dirname(mirrorPath), { recursive: true });
        writeFileSync(
          path.join(sourcePackage, "package.json"),
          '{"name":"@cindy/maker-core"}',
        );
        writeFileSync(sourcePath, "export const safe = true;");
        linkSync(sourcePath, mirrorPath);

        expect(statSync(managedRipgrepPath).isFile()).toBe(true);
        const helpers = loadReviewSearchHelpers(workingDir, {
          managedRipgrepPath,
        });
        const relativeSource = path.relative(workingDir, sourcePath);
        expect(
          helpers.reviewSearchPathIsVisible(
            relativeSource,
            [workingDir],
            workingDir,
          ),
        ).toBe(true);
        const visibleGrep = helpers.filterReviewGrepResult(
          {
            content: [
              {
                type: "text",
                text: `${relativeSource}:1:export const safe = true;`,
              },
            ],
          },
          { path: workingDir },
          [workingDir],
        );
        expect(visibleGrep.content[0]?.text).toContain(relativeSource);
        expect(
          await helpers.rgGlob("index.ts", workingDir, {
            ignore: [],
            limit: 100,
          }),
        ).toContain(sourcePath);

        const outsideSecret = path.join(outsideDir, "secret.ts");
        const outsideAlias = path.join(workingDir, "outside-alias.ts");
        writeFileSync(outsideSecret, "export const secret = true;");
        linkSync(outsideSecret, outsideAlias);
        expect(
          helpers.reviewSearchPathIsVisible(
            "outside-alias.ts",
            [workingDir],
            workingDir,
          ),
        ).toBe(false);
        expect(
          await helpers.rgGlob("*.ts", workingDir, { ignore: [], limit: 100 }),
        ).not.toContain(outsideAlias);

        const thirdLink = path.join(outsideDir, "third-link.ts");
        linkSync(sourcePath, thirdLink);
        expect(
          helpers.reviewSearchPathIsVisible(
            relativeSource,
            [workingDir],
            workingDir,
          ),
        ).toBe(false);
        expect(
          await helpers.rgGlob("index.ts", workingDir, {
            ignore: [],
            limit: 100,
          }),
        ).not.toContain(sourcePath);
        unlinkSync(thirdLink);

        let replaced = false;
        const sourceIdentity = statSync(sourcePath);
        const replacingHelpers = loadReviewSearchHelpers(workingDir, {
          managedRipgrepPath,
          lstatSync: ((candidate: Parameters<typeof lstatSync>[0]) => {
            const candidateStat = lstatSync(candidate);
            if (
              !replaced &&
              candidateStat.isFile() &&
              candidateStat.ino === sourceIdentity.ino &&
              candidateStat.dev === sourceIdentity.dev
            ) {
              replaced = true;
              const candidatePath = candidate.toString();
              unlinkSync(candidatePath);
              writeFileSync(candidatePath, "export const replacement = true;");
              return lstatSync(candidate);
            }
            return candidateStat;
          }) as typeof lstatSync,
        });
        expect(
          await replacingHelpers.rgGlob("index.ts", workingDir, {
            ignore: [],
            limit: 100,
          }),
        ).not.toContain(sourcePath);
        expect(replaced).toBe(true);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(
    process.platform === "win32" || !process.env.CINDY_REVIEW_REAL_WORKSPACE,
  )(
    "keeps a real pnpm-linked workspace file visible to Pi Grep and managed Find",
    async () => {
      const workingDir = process.env.CINDY_REVIEW_REAL_WORKSPACE!;
      const sourcePath = path.join(
        workingDir,
        "apps",
        "mobile",
        "modules",
        "xdt-ios-app-distribution",
        "src",
        "index.ts",
      );
      expect(statSync(sourcePath).nlink).toBe(2);
      const relativeSource = path.relative(workingDir, sourcePath);
      const managedRipgrepPath = path.resolve(
        process.cwd(),
        "..",
        "..",
        "apps",
        "ripgrep-bin",
        `${process.platform}-${process.arch}`,
        "rg",
      );
      const helpers = loadReviewSearchHelpers(workingDir, {
        managedRipgrepPath,
      });
      expect(
        helpers.reviewSearchPathIsVisible(
          relativeSource,
          [workingDir],
          workingDir,
        ),
      ).toBe(true);
      const visibleGrep = helpers.filterReviewGrepResult(
        {
          content: [
            {
              type: "text",
              text: `${relativeSource}:1:export * from './types';`,
            },
          ],
        },
        { path: workingDir },
        [workingDir],
      );
      expect(visibleGrep.content[0]?.text).toContain(relativeSource);
      expect(
        await helpers.rgGlob("index.ts", workingDir, {
          ignore: [],
          limit: 1000,
        }),
      ).toContain(sourcePath);
    },
  );
});
