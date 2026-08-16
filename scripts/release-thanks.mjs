#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const DEFAULT_EXCLUDED_CONTRIBUTORS = ["ChenglongMa", "github-actions[bot]", "dependabot[bot]", "renovate[bot]"];

const DEFAULT_AI_KEYWORDS = ["chatgpt", "claude", "codex", "copilot", "cursor", "openai"];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function splitEnvList(value, fallback) {
  const source = value && value.trim() ? value.split(",") : fallback;
  return source.map((item) => item.trim()).filter(Boolean);
}

function getRepoSlug() {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }

  const remote = git(["remote", "get-url", "origin"]);
  const match = remote.match(/github\.com[:/](?<repo>[^/]+\/[^/.]+)(?:\.git)?$/);
  if (!match?.groups?.repo) {
    throw new Error(`Unable to infer GitHub repository from origin remote: ${remote}`);
  }
  return match.groups.repo;
}

function refExists(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function getPreviousTag(targetRef, targetTag) {
  const tags = git(["tag", "--merged", targetRef, "--sort=-v:refname", "--list", "v[0-9]*"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.find((tag) => tag !== targetTag) || "";
}

function getCommits(targetRef, previousTag) {
  const range = previousTag ? `${previousTag}..${targetRef}` : targetRef;
  return git(["log", "--format=%H%x00%B%x1e", range])
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, ...messageParts] = entry.split("\x00");
      return {
        sha,
        message: messageParts.join("\x00").trim(),
      };
    });
}

function extractPullRequestNumbers(message) {
  const numbers = new Set();
  const patterns = [/Merge pull request #(\d+)/g, /\(#(\d+)\)/g, /\/pull\/(\d+)/g];

  for (const pattern of patterns) {
    for (const match of message.matchAll(pattern)) {
      numbers.add(Number(match[1]));
    }
  }

  return [...numbers].filter(Number.isInteger);
}

async function githubRequest(path, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zoplicate-release-thanks",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

async function getPullRequest(repo, number, token) {
  return githubRequest(`/repos/${repo}/pulls/${number}`, token);
}

async function getPullRequestsForCommit(repo, commit, token) {
  try {
    const pulls = await githubRequest(`/repos/${repo}/commits/${commit.sha}/pulls`, token);
    if (Array.isArray(pulls) && pulls.length > 0) {
      return pulls;
    }
  } catch {
    // Fall back to PR numbers in merge/squash commit messages.
  }

  const numbers = extractPullRequestNumbers(commit.message);
  const pulls = [];
  for (const number of numbers) {
    const pull = await getPullRequest(repo, number, token).catch(() => null);
    if (pull) {
      pulls.push(pull);
    }
  }
  return pulls;
}

function isExcludedContributor(user, excludedContributors, aiKeywords) {
  const login = user?.login || "";
  const loginLower = login.toLowerCase();
  if (!loginLower) {
    return true;
  }
  if (user?.type === "Bot" || loginLower.endsWith("[bot]")) {
    return true;
  }
  if (excludedContributors.has(loginLower)) {
    return true;
  }
  return aiKeywords.some((keyword) => loginLower.includes(keyword));
}

function cleanTitle(title) {
  return String(title).replace(/\s+/g, " ").trim();
}

function formatThanks(pulls, excludedContributors, aiKeywords) {
  const contributors = new Map();

  for (const pull of pulls) {
    if (isExcludedContributor(pull.user, excludedContributors, aiKeywords)) {
      continue;
    }

    const login = pull.user.login;
    if (!contributors.has(login)) {
      contributors.set(login, []);
    }
    contributors.get(login).push({
      number: pull.number,
      title: cleanTitle(pull.title),
    });
  }

  const entries = [...contributors.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return "";
  }

  const lines = ["### Thanks", "", "Thanks to the brilliant contributors for this release:"];
  for (const [login, contributions] of entries) {
    const summary = contributions
      .sort((a, b) => a.number - b.number)
      .map((contribution) => `${contribution.title} (#${contribution.number})`)
      .join("; ");
    lines.push(`- @${login}: ${summary}`);
  }

  return lines.join("\n");
}

async function main() {
  const targetTag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
  const targetRef = targetTag && refExists(targetTag) ? targetTag : "HEAD";
  const previousTag = getPreviousTag(targetRef, targetTag);
  const commits = getCommits(targetRef, previousTag);
  if (commits.length === 0) {
    return;
  }

  const repo = getRepoSlug();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.CHANGELOGEN_TOKENS_GITHUB || "";
  const excludedContributors = new Set(
    splitEnvList(process.env.RELEASE_EXCLUDED_CONTRIBUTORS, DEFAULT_EXCLUDED_CONTRIBUTORS).map((item) =>
      item.toLowerCase(),
    ),
  );
  const aiKeywords = splitEnvList(process.env.RELEASE_AI_CONTRIBUTOR_KEYWORDS, DEFAULT_AI_KEYWORDS).map((item) =>
    item.toLowerCase(),
  );

  const pullsByNumber = new Map();
  for (const commit of commits) {
    const pulls = await getPullRequestsForCommit(repo, commit, token);
    for (const pull of pulls) {
      pullsByNumber.set(pull.number, pull);
    }
  }

  const thanks = formatThanks([...pullsByNumber.values()], excludedContributors, aiKeywords);
  if (thanks) {
    process.stdout.write(`${thanks}\n`);
  }
}

main().catch((error) => {
  console.error(`Skipping contributor thanks: ${error instanceof Error ? error.message : String(error)}`);
});
