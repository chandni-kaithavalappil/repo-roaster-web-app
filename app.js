const form = document.querySelector('#repo-form');
const input = document.querySelector('#repo-input');
const tokenInput = document.querySelector('#token-input');
const saveTokenButton = document.querySelector('#save-token');
const clearTokenButton = document.querySelector('#clear-token');
const statusPanel = document.querySelector('#status');
const reportPanel = document.querySelector('#report');
const analyzeButton = document.querySelector('#analyze-button');

const STORAGE_TOKEN_KEY = 'repo-roster-github-token';
const COLORS = ['#60a5fa', '#a78bfa', '#22d3ee', '#36d399', '#fbbf24', '#fb7185', '#f472b6', '#c084fc'];

const CANDIDATES = {
  readme: ['README.md', 'readme.md', 'Readme.md', 'README', 'docs/README.md'],
  packages: [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'vite.config.js', 'vite.config.ts',
    'next.config.js', 'next.config.mjs', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'poetry.lock',
    'go.mod', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'Dockerfile', 'docker-compose.yml',
    'render.yaml', 'vercel.json', 'netlify.toml'
  ],
  server: [
    'server.js', 'app.js', 'index.js', 'main.py', 'app.py', 'server.py', 'src/server.js', 'src/app.js',
    'src/index.js', 'api/index.js', 'backend/server.js', 'backend/app.js'
  ],
  frontend: ['index.html', 'src/App.jsx', 'src/App.tsx', 'src/main.jsx', 'src/main.tsx', 'app/page.tsx', 'pages/index.js']
};

function init() {
  const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
  if (savedToken) tokenInput.value = savedToken;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await analyzeRepo(input.value.trim());
  });

  document.querySelectorAll('.example').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.repo;
      analyzeRepo(button.dataset.repo);
    });
  });

  saveTokenButton.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) return showStatus('Paste a token first, or leave it empty to use public GitHub limits.', 'error');
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
    showStatus('Token saved locally in this browser. It will only be sent to api.github.com requests.', 'ok');
  });

  clearTokenButton.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    tokenInput.value = '';
    showStatus('Local token cleared.', 'ok');
  });
}

function parseRepo(value) {
  const cleaned = value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\.git$/, '').replace(/\/$/, '');
  const match = cleaned.match(/^(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/.*)?$/);
  if (!match) throw new Error('Please enter a valid public GitHub repo URL, like owner/repo.');
  return { owner: match[1], repo: match[2] };
}

async function analyzeRepo(value) {
  let parsed;
  try {
    parsed = parseRepo(value);
  } catch (error) {
    showStatus(error.message, 'error');
    return;
  }

  reportPanel.classList.add('hidden');
  analyzeButton.disabled = true;
  showStatus(`Fetching ${parsed.owner}/${parsed.repo} from GitHub...`, 'ok');

  try {
    const repo = await github(`/repos/${parsed.owner}/${parsed.repo}`);
    showStatus(`Reading repo tree, languages, README, and project signals for ${repo.full_name}...`, 'ok');

    const [languages, treeResponse] = await Promise.all([
      github(`/repos/${parsed.owner}/${parsed.repo}/languages`).catch(() => ({})),
      github(`/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`)
    ]);

    const tree = Array.isArray(treeResponse.tree) ? treeResponse.tree : [];
    const files = tree.filter((item) => item.type === 'blob');
    const filePaths = new Set(files.map((file) => file.path));
    const lowerPathMap = new Map(files.map((file) => [file.path.toLowerCase(), file.path]));

    const readmePath = firstExisting(CANDIDATES.readme, lowerPathMap);
    const readme = readmePath ? await rawText(parsed, repo.default_branch, readmePath).catch(() => '') : '';
    const packagePath = firstExisting(CANDIDATES.packages, lowerPathMap);
    const packageJson = filePaths.has('package.json') ? await rawText(parsed, repo.default_branch, 'package.json').catch(() => '') : '';
    const serverPath = firstExisting(CANDIDATES.server, lowerPathMap) || findByPattern(files, /(^|\/)(server|app|index)\.(js|ts|py|rb|go)$/i);
    const serverCode = serverPath ? await rawText(parsed, repo.default_branch, serverPath).catch(() => '') : '';

    const analysis = buildAnalysis({ repo, languages, tree, files, readme, packageJson, serverCode, packagePath, serverPath, filePaths });
    renderReport(analysis);
    showStatus(`Report ready for ${repo.full_name}.`, 'ok');
  } catch (error) {
    const hint = String(error.message || '').includes('rate limit')
      ? ' GitHub rate limit may be exhausted. Add a local token or try again later.'
      : '';
    showStatus(`${error.message || 'Could not inspect that repo.'}${hint}`, 'error');
  } finally {
    analyzeButton.disabled = false;
  }
}

async function github(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = tokenInput.value.trim() || localStorage.getItem(STORAGE_TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).message || ''; } catch {}
    throw new Error(`GitHub returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return response.json();
}

async function rawText(parsed, branch, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) throw new Error(`Could not read ${path}`);
  return response.text();
}

function firstExisting(candidates, lowerPathMap) {
  for (const candidate of candidates) {
    const found = lowerPathMap.get(candidate.toLowerCase());
    if (found) return found;
  }
  return '';
}

function findByPattern(files, regex) {
  return files.find((file) => regex.test(file.path))?.path || '';
}

function buildAnalysis(context) {
  const { repo, languages, tree, files, readme, packageJson, serverCode, packagePath, serverPath, filePaths } = context;
  const lowerPaths = [...filePaths].map((path) => path.toLowerCase());
  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const languageTotal = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);
  const packageInfo = parsePackage(packageJson);
  const readmeLower = readme.toLowerCase();
  const envReferenced = /process\.env|import\.meta\.env|dotenv|env var|environment variable|api[_-]?key/i.test(`${serverCode}\n${readme}\n${packageJson}`);

  const signals = {
    readme: Boolean(readme),
    setup: /npm install|npm start|npm run|pip install|poetry install|pnpm install|yarn install|cargo run|go run|docker compose|python3? -m|local development|getting started|installation|setup/i.test(readme),
    packageFile: Boolean(packagePath),
    startScript: Boolean(packageInfo.scripts?.start || packageInfo.scripts?.dev || packageInfo.scripts?.serve),
    tests: lowerPaths.some((path) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.(js|jsx|ts|tsx|py)$/i.test(path)) || Boolean(packageInfo.scripts?.test),
    ci: lowerPaths.some((path) => path.startsWith('.github/workflows/')),
    envExample: lowerPaths.some((path) => /(^|\/)\.env\.(example|sample|template)$|(^|\/)example\.env$/i.test(path)),
    license: Boolean(repo.license) || lowerPaths.some((path) => /^licen[sc]e(\.|$)/i.test(path)),
    deploy: lowerPaths.some((path) => /(render\.yaml|vercel\.json|netlify\.toml|dockerfile|docker-compose\.ya?ml|\.github\/workflows\/.*deploy)/i.test(path)) || /render\.com|vercel\.app|netlify\.app|github\.io/i.test(`${readme}\n${repo.homepage || ''}`),
    liveDemo: Boolean(repo.homepage) || /live demo|demo:|render\.com|vercel\.app|netlify\.app|github\.io/i.test(readme),
    server: Boolean(serverPath),
    frontend: lowerPaths.some((path) => /(index\.html|src\/app\.|src\/main\.|src\/components|app\/page\.|pages\/index\.)/i.test(path))
  };

  const dependencies = packageInfo.dependencies ? Object.keys(packageInfo.dependencies).length : 0;
  const devDependencies = packageInfo.devDependencies ? Object.keys(packageInfo.devDependencies).length : 0;
  const dependencyCount = dependencies + devDependencies;

  const mainScore = clamp(
    50
    + (readme.length > 1000 ? 10 : 0)
    + (signals.setup ? 8 : 0)
    + (signals.packageFile ? 8 : 0)
    + (signals.startScript ? 8 : 0)
    + (envReferenced && signals.envExample ? 8 : 0)
    + (signals.liveDemo ? 8 : 0)
    + (signals.ci ? 8 : 0)
    + (signals.tests ? 8 : 0)
    + (signals.license ? 5 : 0)
    - (!signals.readme ? 10 : 0)
    - (!signals.setup ? 10 : 0)
    - (!signals.tests ? 6 : 0)
    - (!signals.ci ? 6 : 0)
    - (!signals.license ? 3 : 0)
    - (envReferenced && signals.server && !signals.envExample ? 8 : 0)
    - (signals.packageFile && packageInfo.name && !lowerPaths.some((path) => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock/.test(path)) ? 8 : 0)
    - (files.length < 3 ? 10 : 0)
  );

  const subscores = {
    'Demo readiness': clamp(45 + (signals.liveDemo ? 18 : 0) + (signals.startScript ? 14 : 0) + (signals.envExample || !envReferenced ? 10 : -12) + (signals.setup ? 10 : 0)),
    Documentation: clamp(30 + (signals.readme ? 22 : 0) + (readme.length > 1000 ? 18 : 0) + (signals.setup ? 18 : 0) + (signals.liveDemo ? 8 : 0)),
    'Setup clarity': clamp(35 + (signals.setup ? 24 : 0) + (signals.startScript ? 16 : 0) + (signals.envExample ? 14 : 0) + (packagePath ? 8 : 0)),
    'Code organization': clamp(50 + (files.length > 6 ? 10 : 0) + (signals.server ? 8 : 0) + (signals.frontend ? 8 : 0) + (tree.some((x) => x.path === 'src' && x.type === 'tree') ? 8 : 0)),
    'Reliability signals': clamp(28 + (signals.tests ? 24 : 0) + (signals.ci ? 24 : 0) + (signals.license ? 8 : 0) + (signals.deploy ? 8 : 0)),
    'Product/story clarity': clamp(38 + (repo.description ? 14 : 0) + (readme.length > 700 ? 14 : 0) + (/what it does|features|demo|screenshots?|how it works/i.test(readme) ? 18 : 0)),
    'Visual polish': clamp(42 + (signals.frontend ? 14 : 0) + (lowerPaths.some((path) => /\.css$|tailwind|scss|sass/i.test(path)) ? 14 : 0) + (/screenshot|design|ui|css|theme/i.test(readme) ? 10 : 0))
  };

  const readiness = mainScore >= 80 ? 'Green' : mainScore >= 55 ? 'Amber' : 'Red';
  const readinessNote = readiness === 'Green'
    ? 'Demo-ready, but still rehearse.'
    : readiness === 'Amber'
      ? 'Good prototype energy; prepare fallbacks.'
      : 'Do not put this in front of a room without a seatbelt.';

  return {
    repo,
    tree,
    files,
    readme,
    packageInfo,
    packagePath,
    serverPath,
    languages,
    languageTotal,
    totalBytes,
    dependencyCount,
    envReferenced,
    signals,
    score: mainScore,
    subscores,
    readiness,
    readinessNote,
    sections: generateSections({ repo, files, readme, packagePath, packageInfo, serverPath, signals, score: mainScore, readiness, dependencyCount, envReferenced, languages })
  };
}

function parsePackage(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function generateSections(data) {
  const { repo, files, readme, packagePath, packageInfo, serverPath, signals, readiness, dependencyCount, envReferenced, languages } = data;
  const languageNames = Object.keys(languages);
  const primary = repo.language || languageNames[0] || 'code';
  const appType = signals.frontend && signals.server ? 'full-stack' : signals.frontend ? 'frontend' : signals.server ? 'backend/API' : `${primary} project`;

  const whatItDoes = repo.description
    ? `${repo.full_name} appears to be a ${appType} focused on: ${repo.description}`
    : `${repo.full_name} appears to be a ${appType}. The README ${readme ? 'provides additional context' : 'is missing, so the product story is inferred from files and repo metadata'}.`;

  const workingWell = [
    signals.readme && readme.length > 1000 ? 'README has enough substance to explain the project instead of just waving from across the room.' : null,
    signals.setup ? 'Setup/run instructions are present, which is excellent for demo recovery.' : null,
    signals.startScript ? `Package scripts include ${scriptNames(packageInfo).join(', ')}, so local startup is discoverable.` : null,
    signals.liveDemo ? 'A live demo/homepage signal exists, which helps evaluators see the product quickly.' : null,
    signals.envExample ? 'Environment variables have an example file, reducing setup guesswork.' : null,
    signals.frontend ? 'Frontend/UI files are present, so there is something visual to demo.' : null,
    languageNames.length ? `Language breakdown is available across ${languageNames.slice(0, 3).join(', ')}${languageNames.length > 3 ? ', and more' : ''}.` : null
  ].filter(Boolean);

  const breaks = [
    !signals.liveDemo ? 'No obvious live demo link detected; the presenter may need to run it locally.' : null,
    !signals.setup ? 'Setup instructions are weak or missing, which is how demos become archaeology.' : null,
    envReferenced && !signals.envExample ? 'Environment variables are referenced, but no .env example was detected.' : null,
    signals.server && !signals.ci ? 'Server/API code exists without CI signals, so regressions may sneak in wearing sunglasses.' : null,
    !signals.tests ? 'No test signals detected; the happy path should be manually rehearsed.' : null,
    files.length > 500 ? 'Large repo tree may make browser-side inspection slower under GitHub API limits.' : null
  ].filter(Boolean);

  const engineeringGaps = [
    !signals.tests ? 'Add at least smoke tests for the main user flow.' : null,
    !signals.ci ? 'Add a minimal GitHub Actions workflow for lint/test/build or static validation.' : null,
    envReferenced && !signals.envExample ? 'Document required environment variables in .env.example.' : null,
    packagePath && packageInfo.name && !signals.startScript ? 'Add clear npm scripts for start/dev/test.' : null,
    !signals.license ? 'Add a license if this is intended for reuse.' : null,
    !signals.deploy ? 'Add deployment configuration or deployment notes.' : null
  ].filter(Boolean);

  const productGaps = [
    !repo.description ? 'Add a crisp GitHub repo description so the project explains itself before the README loads.' : null,
    !signals.liveDemo ? 'Add a hosted demo link or screenshots to make the value visible immediately.' : null,
    !/features|what it does|use case|problem|why/i.test(readme) ? 'State the user problem and the core value proposition more explicitly.' : null,
    !/screenshot|demo|gif|video/i.test(readme) ? 'Add screenshots or a short demo GIF for faster comprehension.' : null,
    readiness !== 'Green' ? 'Frame it as a prototype and name the known demo-safe path.' : null
  ].filter(Boolean);

  const fixes = [
    !signals.setup ? 'Write a 5-command quickstart in the README.' : null,
    envReferenced && !signals.envExample ? 'Add .env.example with every required variable and safe placeholder values.' : null,
    !signals.liveDemo ? 'Add a demo URL, screenshot, or GIF near the top of the README.' : null,
    !signals.tests ? 'Add one smoke test or manual test checklist for the golden path.' : null,
    !signals.ci ? 'Add a tiny GitHub Actions workflow to catch broken installs/builds.' : null,
    !repo.description ? 'Add a one-line repo description in GitHub settings.' : null,
    packagePath && packageInfo.name && !signals.startScript ? 'Add start/dev scripts so reviewers do not guess commands.' : null
  ].filter(Boolean).slice(0, 5);

  while (fixes.length < 5) fixes.push(['Rehearse the main demo path and document the fallback.', 'Add one known-good sample input/query.', 'Tighten README wording around what is prototype vs done.', 'Remove unused files or document why they exist.', 'Add troubleshooting notes for common setup failures.'][fixes.length]);

  const roast = makeRoast({ repo, signals, readiness, files, readme, dependencyCount });

  return {
    whatItDoes,
    workingWell: workingWell.length ? workingWell : ['The repo is publicly accessible and inspectable, which is already better than mystery ZIP energy.'],
    roast,
    breaks: breaks.length ? breaks : ['Nothing obvious from static signals, but live demos are gremlins: rehearse the exact path anyway.'],
    engineeringGaps: engineeringGaps.length ? engineeringGaps : ['No major static engineering gaps detected for a prototype. Keep the scope honest and avoid surprise complexity.'],
    productGaps: productGaps.length ? productGaps : ['The product story has enough visible scaffolding for a prototype. Sharpen the demo narrative before sharing widely.'],
    fixes
  };
}

function makeRoast({ repo, signals, readiness, files, readme, dependencyCount }) {
  if (readiness === 'Green') {
    return `${repo.name} looks demo-ready enough to make eye contact with stakeholders. Still, rehearse it — every live demo has a tiny goblin assigned to the Wi-Fi.`;
  }
  if (!signals.readme) {
    return `${repo.name} has chosen the mysterious stranger aesthetic: interesting files, minimal explanation, and a README-shaped hole where confidence should be.`;
  }
  if (!signals.tests && !signals.ci) {
    return `The README is doing the talking, but tests and CI appear to be on a silent retreat. Charming prototype, slightly haunted safety net.`;
  }
  if (dependencyCount > 40 && !signals.setup) {
    return `${repo.name} brought a dependency buffet but forgot to label the dishes. Delicious maybe, but the demo chef needs instructions.`;
  }
  if (files.length < 6) {
    return `${repo.name} is refreshingly tiny — less codebase, more code-snack. Great for demos, as long as the snack has instructions.`;
  }
  return `${repo.name} has real prototype energy: useful, inspectable, and one missing polish pass away from walking into the demo room with better shoes.`;
}

function renderReport(analysis) {
  const { repo, score, readiness, readinessNote, subscores, languages, languageTotal, totalBytes, files, dependencyCount, signals, sections } = analysis;
  const scoreColor = readiness === 'Green' ? 'var(--green)' : readiness === 'Amber' ? 'var(--amber)' : 'var(--red)';

  reportPanel.innerHTML = `
    <div class="report-hero">
      <article class="repo-title glass-card">
        <p class="eyebrow">Repo Roster Report</p>
        <h2>${escapeHtml(repo.full_name)}</h2>
        <p>${escapeHtml(repo.description || 'No GitHub description provided.')}</p>
        <div class="repo-meta">
          <a class="pill" href="${repo.html_url}" target="_blank" rel="noreferrer">View on GitHub</a>
          ${repo.homepage ? `<a class="pill" href="${escapeAttr(repo.homepage)}" target="_blank" rel="noreferrer">Live/demo link</a>` : ''}
          <span class="pill">Default branch: ${escapeHtml(repo.default_branch)}</span>
          <span class="pill">Primary: ${escapeHtml(repo.language || 'Unknown')}</span>
        </div>
      </article>
      <aside class="readiness-card glass-card">
        <div class="score-ring" style="--score:${score}; --score-color:${scoreColor}">
          <div class="score-inner"><strong>${score}</strong><span>/ 100</span></div>
        </div>
        <div class="score-label" style="color:${scoreColor}">${readiness}</div>
        <p class="score-note">${readinessNote}</p>
      </aside>
    </div>

    <div class="stats-grid">
      ${statCard('Stars', formatNumber(repo.stargazers_count))}
      ${statCard('Forks', formatNumber(repo.forks_count))}
      ${statCard('Open issues', formatNumber(repo.open_issues_count))}
      ${statCard('Files', formatNumber(files.length))}
      ${statCard('Repo size', formatBytes(totalBytes))}
      ${statCard('Updated', timeAgo(repo.updated_at))}
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <h3>Sub-scores</h3>
        ${Object.entries(subscores).map(([label, value]) => scoreBar(label, value)).join('')}
      </section>
      <section class="panel">
        <h3>Language breakdown</h3>
        ${renderLanguages(languages, languageTotal)}
      </section>
    </div>

    <section class="panel">
      <h3>Demo readiness signals</h3>
      <div class="signals-grid">
        ${signalCard('README', signals.readme, signals.readme ? 'Detected' : 'Missing')}
        ${signalCard('Setup docs', signals.setup, signals.setup ? 'Run/setup clues found' : 'Needs quickstart')}
        ${signalCard('Tests', signals.tests, signals.tests ? 'Test signal found' : 'No test signal')}
        ${signalCard('CI', signals.ci, signals.ci ? 'GitHub workflow found' : 'No workflow found')}
        ${signalCard('Env example', signals.envExample, signals.envExample ? 'Safe placeholders found' : 'Not detected')}
        ${signalCard('License', signals.license, signals.license ? 'License signal found' : 'Not detected')}
        ${signalCard('Live demo', signals.liveDemo, signals.liveDemo ? 'Demo/homepage clue' : 'Not detected')}
        ${signalCard('Dependencies', dependencyCount > 0, dependencyCount ? `${dependencyCount} package deps` : 'No package deps parsed')}
      </div>
    </section>

    <div class="section-grid">
      ${sectionBlock(1, 'What this repo does', `<p>${escapeHtml(sections.whatItDoes)}</p>`)}
      ${sectionBlock(2, 'What is working well', list(sections.workingWell))}
      ${sectionBlock(3, 'Demo readiness score', `<p><strong style="color:${scoreColor}">${readiness} — ${score}/100.</strong> ${readinessNote}</p>`)}
      ${sectionBlock(4, 'Friendly roast', `<p class="roast">${escapeHtml(sections.roast)}</p>`)}
      ${sectionBlock(5, 'What may break during a live demo', list(sections.breaks))}
      ${sectionBlock(6, 'Engineering gaps', list(sections.engineeringGaps))}
      ${sectionBlock(7, 'Product/story gaps', list(sections.productGaps))}
      ${sectionBlock(8, 'Top 5 fixes for the next 2 hours', `<div class="fix-grid">${sections.fixes.map((fix, index) => `<article class="fix-card"><b>${index + 1}. Fix</b><span>${escapeHtml(fix)}</span></article>`).join('')}</div>`, true)}
    </div>
  `;
  reportPanel.classList.remove('hidden');
  reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function statCard(label, value) {
  return `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function scoreBar(label, value) {
  const color = value >= 80 ? 'var(--green)' : value >= 55 ? 'var(--amber)' : 'var(--red)';
  return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(label)}</span><strong>${value}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${value}%; background:${color}"></div></div></div>`;
}

function renderLanguages(languages, total) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  if (!entries.length || !total) return '<p>No language data returned by GitHub.</p>';
  return `
    <div class="lang-stack">${entries.map(([name, bytes], index) => `<span class="lang-seg" title="${escapeAttr(name)}" style="width:${(bytes / total) * 100}%; background:${COLORS[index % COLORS.length]}"></span>`).join('')}</div>
    <div class="lang-list">
      ${entries.slice(0, 8).map(([name, bytes], index) => `<div class="lang-item"><span class="lang-name"><i class="dot" style="background:${COLORS[index % COLORS.length]}"></i>${escapeHtml(name)}</span><strong>${Math.round((bytes / total) * 100)}%</strong></div>`).join('')}
    </div>
  `;
}

function signalCard(label, ok, detail) {
  return `<article class="signal ${ok ? 'good' : 'warn'}"><strong>${ok ? '✓' : '!' } ${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function sectionBlock(number, title, body, full = false) {
  return `<section class="report-section ${full ? 'full' : ''}"><h3><span class="number-badge">${number}</span>${escapeHtml(title)}</h3>${body}</section>`;
}

function list(items) {
  return `<ul class="clean-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function scriptNames(packageInfo) {
  return Object.keys(packageInfo.scripts || {}).filter((name) => ['start', 'dev', 'serve', 'test', 'build'].includes(name));
}

function showStatus(message, type = 'ok') {
  statusPanel.textContent = message;
  statusPanel.className = `status-panel ${type === 'error' ? 'error' : ''}`;
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatNumber(value) {
  return Intl.NumberFormat('en', { notation: value > 9999 ? 'compact' : 'standard' }).format(value || 0);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const days = Math.max(0, Math.round((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

init();
