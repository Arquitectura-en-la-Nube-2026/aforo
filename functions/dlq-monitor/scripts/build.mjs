// Bundles the function into dist/ as a deployable source: one index.js (with @aforo/common
// inlined) and a package.json with only the runtime dependency the platform installs.
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "dist/index.js",
  // Must stay external: the runtime loads it and our handler registers on the same instance.
  external: ["@google-cloud/functions-framework"],
});

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  "dist/package.json",
  JSON.stringify(
    {
      name: pkg.name.replace("@aforo/", "aforo-"),
      version: pkg.version,
      private: true,
      main: "index.js",
      engines: { node: "24" },
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + "\n",
);
