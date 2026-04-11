import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { copyFileSync, existsSync } from "fs";

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
    startArgs: [],
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
        },
        bundle: true,
        target: "firefox115",
        outfile: `build/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
    hooks: {
      "build:makeUpdateJSON": (ctx) => {
        ["update.json", "update-beta.json"].forEach((fileName) => {
          const source = `build/${fileName}`;
          if (existsSync(source)) {
            copyFileSync(source, fileName);
          }
        });
      },
    },
  },
  release: {
    bumpp: {
      execute: "npm run build",
      all: true,
    },
  },

  // If you need to see a more detailed build log, uncomment the following line:
  // logLevel: "trace",
});
