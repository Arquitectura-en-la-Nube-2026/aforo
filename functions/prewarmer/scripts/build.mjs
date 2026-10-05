// Bundles the function into dist/ as a deployable source: one index.js (google-auth-library and
// @aforo/common inlined) and a package.json with only the runtime dependency left external.
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

// Must stay external: the runtime loads it and our handler registers on the same instance.
const external = ["@google-cloud/functions-framework"];

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: "dist/index.js",
  external,
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
      dependencies: Object.fromEntries(external.map((name) => [name, pkg.dependencies[name]])),
    },
    null,
    2,
  ) + "\n",
);
