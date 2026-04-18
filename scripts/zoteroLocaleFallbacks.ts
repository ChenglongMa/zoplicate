import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

// Synced with zotero/zotero chrome/locale on 2026-04-18.
export const ZOTERO_LOCALES = [
  "af-ZA",
  "ar",
  "bg-BG",
  "br",
  "ca-AD",
  "cs-CZ",
  "da-DK",
  "de",
  "el-GR",
  "en-GB",
  "en-US",
  "es-ES",
  "et-EE",
  "eu-ES",
  "fa",
  "fi-FI",
  "fr-FR",
  "gl-ES",
  "he-IL",
  "hr-HR",
  "hu-HU",
  "id-ID",
  "is-IS",
  "it-IT",
  "ja-JP",
  "km",
  "ko-KR",
  "lt-LT",
  "mn-MN",
  "nb-NO",
  "nl-NL",
  "nn-NO",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sl-SI",
  "sr-RS",
  "sv-SE",
  "ta",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "vi-VN",
  "zh-CN",
  "zh-TW",
] as const;

export type ZoteroLocale = (typeof ZOTERO_LOCALES)[number];

const fallbackFTLContent = [
  "# This locale intentionally contains no messages.",
  "# It keeps Zotero's native UI locale bundle complete when Zoplicate",
  "# Fluent files are inserted into shared Zotero documents.",
  "",
].join("\n");

export function ensureZoteroLocaleFallbacks(
  dist: string,
  namespace: string,
  locales: readonly string[] = ZOTERO_LOCALES,
): string[] {
  const localeRoot = join(dist, "addon", "locale");
  const enUSLocaleDir = join(localeRoot, "en-US");

  if (!existsSync(enUSLocaleDir)) {
    return [];
  }

  const fluentFiles = readdirSync(enUSLocaleDir)
    .filter((fileName) => fileName.endsWith(".ftl"))
    .filter((fileName) => fileName.startsWith(`${namespace}-`));

  const createdFiles: string[] = [];

  for (const locale of locales) {
    const localeDir = join(localeRoot, locale);
    mkdirSync(localeDir, { recursive: true });

    for (const fileName of fluentFiles) {
      const target = join(localeDir, fileName);
      if (existsSync(target)) {
        continue;
      }
      writeFileSync(target, fallbackFTLContent, "utf-8");
      createdFiles.push(target);
    }
  }

  return createdFiles;
}
