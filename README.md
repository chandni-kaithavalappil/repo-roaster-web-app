# Repo Roster

Paste a public GitHub repository URL and get a practical, visual demo-readiness report with real repo stats, scores, engineering gaps, product/story gaps, top fixes, and a friendly roast.

Repo Roster is designed for prototype and demo readiness reviews. It is not a production security audit and it does not modify the repositories it inspects.

## Features

- Inspect any public GitHub repo by URL or `owner/repo` shorthand
- Fetch real metadata from GitHub APIs
- Show stars, forks, open issues, last updated date, file count, approximate repo size, and language breakdown
- Detect useful demo-readiness signals:
  - README
  - setup instructions
  - package/dependency files
  - start/dev scripts
  - tests
  - CI workflows
  - env example
  - license
  - live demo/homepage
  - deploy config
- Generate a structured Repo Roster Report:
  1. What this repo does
  2. What is working well
  3. Demo readiness score: Green / Amber / Red
  4. Friendly roast
  5. What may break during a live demo
  6. Engineering gaps
  7. Product/story gaps
  8. Top 5 fixes for the next 2 hours
- Render a dark, responsive dashboard with visual scores, language bars, signal cards, and prioritized action cards
- Run fully as a static GitHub Pages app

## Live demo

After GitHub Pages is enabled, the app will be available at:

```text
https://chandni-kaithavalappil.github.io/repo-roster-web-app/
```

## How it works

This is a frontend-only static web app. It calls public GitHub endpoints from the browser:

```text
GET https://api.github.com/repos/{owner}/{repo}
GET https://api.github.com/repos/{owner}/{repo}/languages
GET https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1
GET https://raw.githubusercontent.com/{owner}/{repo}/{default_branch}/{path}
```

The app then uses deterministic static heuristics to calculate demo-readiness signals and generate the report.

### What "static heuristics" means

Repo Roster does not run the target repo, clone it, execute tests, or send the code to an AI model. It reads public metadata and selected public files, then applies deterministic rules of thumb in `app.js`.

Examples of the signals it checks:

- Is there a README?
- Does the README include setup or run instructions?
- Is there a package/dependency file such as `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, or `Cargo.toml`?
- Are there start/dev/test scripts?
- Are there test files or test folders?
- Is there CI under `.github/workflows/`?
- Is there an `.env.example` or similar file when environment variables appear to be used?
- Is there a license?
- Is there a live demo/homepage or deploy config?
- What languages, file count, repo size, stars, forks, issues, and last-updated date does GitHub report?

Those signals are converted into scores and report sections using transparent rules. For example, setup docs, tests, CI, a license, and a live demo raise the score; missing tests, CI, setup docs, or env examples lower it.

This makes the app fast, free, explainable, and safe to host on GitHub Pages. The tradeoff is that it is a prototype-readiness signal checker, not a deep code review, security audit, or production-readiness assessment.

No target repository is cloned or modified.

## Local setup

Clone this repository:

```bash
git clone https://github.com/chandni-kaithavalappil/repo-roster-web-app.git
cd repo-roster-web-app
```

Serve the static files locally:

```bash
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

You can also use any static server, for example:

```bash
npx serve .
```

## Deploy to GitHub Pages

This repo is intended to be hosted from the root of the `main` branch.

1. Open the GitHub repo in your browser.
2. Go to Settings -> Pages.
3. Under Build and deployment, choose:
   - Source: Deploy from a branch
   - Branch: main
   - Folder: /root
4. Click Save.

The app should appear at:

```text
https://chandni-kaithavalappil.github.io/repo-roster-web-app/
```

## Rate limits

Unauthenticated GitHub API calls are limited, usually to 60 requests per hour per IP address.

If you hit rate limits, wait for the limit to reset or use the optional token field in the app. The token is stored only in your browser localStorage and is sent only to `api.github.com` requests.

Do not use the optional token feature on shared computers.

## Privacy

- This app inspects public GitHub repositories only.
- No server stores repo data.
- No target repo is modified.
- All analysis runs in the user's browser.
- Optional GitHub tokens stay in browser localStorage and are never committed to this repo.

## Limitations

- Static heuristics are useful prototype-readiness signals, not a full code audit. The app does not run code, execute tests, or make AI/LLM calls.
- Public repos only.
- Very large repos may be slow or hit GitHub API limits.
- GitHub Pages cannot safely hide API keys. Do not add private LLM keys directly to frontend code.
- The roast is generated from observed repo signals and should stay respectful.

## Project structure

```text
.
├── index.html   # Static page and app shell
├── styles.css   # Dashboard styling
├── app.js       # GitHub API fetching, scoring, and report rendering
├── .nojekyll    # GitHub Pages passthrough
├── .gitignore   # Keeps local junk out of git
└── README.md
```

## Roadmap

- Export report as Markdown
- Save/share report as a URL hash
- Compare two repos side-by-side
- More language-specific analysis heuristics
- Optional backend for private repo support or LLM-generated narrative
