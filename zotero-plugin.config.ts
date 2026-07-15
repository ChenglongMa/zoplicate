import { execFileSync } from "node:child_process";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { ensureZoteroLocaleFallbacks, ZOTERO_LOCALES } from "./scripts/zoteroLocaleFallbacks";

const localeFallbackLocales =
  process.env.ZOPLICATE_LOCALE_FALLBACKS === "minimal" ? (["en-US", "zh-CN"] as const) : ZOTERO_LOCALES;

function removeGeneratedContributors(changelog: string): string {
  return changelog.replace(/\n###[^\n]*Contributors[\s\S]*?(?=\n### |\n## |$)/, "").trim();
}

function getContributorThanks(version: string): string {
  try {
    return execFileSync("node", ["scripts/release-thanks.mjs", `v${version}`], {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch (error) {
    console.warn(`Skipping contributor thanks: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: "https://github.com/{{owner}}/{{repo}}/releases/download/release/{{updateJson}}",
  xpiDownloadLink: "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",
  server: {
    // asProxy: true,
    devtools: true,
    startArgs: ["-ZoteroDebugText"],
    prefs: {
      "extensions.zotero.debug.log": true,
    },
  },

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
          __devItemIDColumn__: JSON.stringify(process.env.ZOPLICATE_DEV_ITEM_ID_COLUMN === "1"),
        },
        bundle: true,
        target: "firefox115",
        outfile: `build/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
    hooks: {
      "build:fluent": (ctx) => {
        ensureZoteroLocaleFallbacks(ctx.dist, ctx.namespace, localeFallbackLocales);
      },
    },
  },
  release: {
    bumpp: {
      execute: "npm run build",
      all: true,
    },
    github: {
      releaseNote: (ctx) => {
        const changelog = removeGeneratedContributors(ctx.release.changelog);
        const thanks = getContributorThanks(ctx.version);
        return [changelog, thanks].filter(Boolean).join("\n\n");
      },
    },
  },

  // If you need to see a more detailed build log, uncomment the following line:
  // logLevel: "trace",
});
