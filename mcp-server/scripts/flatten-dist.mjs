// Post-build step for `npm run build`.
//
// `tsconfig.json`'s `@devdigest/shared` path alias points at a real `.ts`
// source file outside this package (`../server/src/vendor/shared/index.ts`),
// so `tsc` pulls it into the compiled program for type resolution even though
// every use of it here is `import type` (REQ-4 — fully erased at compile
// time, confirmed empirically: the emitted `dist/**/*.js` files contain zero
// references to the vendor path). Because that file sits outside any
// `rootDir` this package could declare, `tsc` computes the emit root as the
// repo-level common ancestor of every file in the program instead of `src/`,
// nesting real output under `dist/mcp-server/src/**` alongside a dead,
// never-imported `dist/server/src/vendor/shared/**` copy of the vendor
// tree's *compiled* (not type-only) output.
//
// This script flattens `dist/mcp-server/src/**` up to `dist/**` (so
// `package.json`'s `"start": "node dist/index.js"` and any external launcher
// — e.g. Claude Desktop's `mcpServers` config — get the flat path they
// expect) and deletes the dead `dist/mcp-server` and `dist/server` trees.
//
// See docs/plans/mcp-server.md, "Risks & Mitigations", for the full story;
// setting `rootDir: "src"` looks like the obvious fix but does NOT work here
// — it makes `tsc` refuse to compile at all (`TS6059`), including under
// `--noEmit`, because the vendor file is still pulled into the *program* for
// type-checking even though it is never pulled into the *output*.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const distDir = new URL('../dist/', import.meta.url).pathname;
const nestedSrcDir = join(distDir, 'mcp-server', 'src');

if (!existsSync(nestedSrcDir)) {
  console.error(
    `flatten-dist: expected nested output at ${nestedSrcDir} — tsc's emit layout changed; ` +
      'update this script (or revisit the rootDir fix in tsconfig.json) before relying on it.',
  );
  process.exit(1);
}

// cpSync + rm (not a single rename) because `dist/mcp-server` and `dist/` are
// not siblings on the same parent — `nestedSrcDir` is two levels down.
cpSync(nestedSrcDir, distDir, { recursive: true });
rmSync(join(distDir, 'mcp-server'), { recursive: true, force: true });
rmSync(join(distDir, 'server'), { recursive: true, force: true });

if (!existsSync(join(distDir, 'index.js'))) {
  console.error('flatten-dist: dist/index.js is missing after flattening — build is broken.');
  process.exit(1);
}

console.error('flatten-dist: dist/ flattened to a plain src/-relative layout.');
