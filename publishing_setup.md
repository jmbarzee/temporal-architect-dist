# Publishing & Distribution Setup

Actionable rollout for getting every distribution channel from "wired in CI" to "verified end-to-end on the public registry." Pair with [`packaging.md`](./packaging.md) for design rationale and the [package table in the README](./README.md#how-it-works) for what's shipping where.

## Status snapshot

| Channel | CI wired | Account / token | First publish landed | Notes |
|---|---|---|---|---|
| VS Code Marketplace (`jmbarzee.twf-syntax`) | yes | yes (`VSCE_TOKEN`) | yes — last shipped `v0.3.2` | Listing's "View Source" link resolves to the renamed repo. |
| Open VSX (`jmbarzee/twf-syntax`) | yes | yes (`OVSX_TOKEN`) | yes — last shipped `v0.3.2` | Same. |
| GitHub Release assets (`twf-*`, `skills-*`, visualizer + wire-types tarballs, `SHA256SUMS`) | yes | (built-in) | **partial** — `v0.3.2` shipped only VSIX files; the binary archive + skills tarball + visualizer/wire-types wiring landed after `v0.3.2`. First end-to-end run will be the next `v*` tag. (`install.sh` is served from this repo via raw URL, not a Release asset.) |
| npm `@temporal-architect/visualizer` + `@temporal-architect/wire-types` | n/a — **published from the toolchain repo** (`release.yml`), not here | OIDC trusted publishing (no token) | yes — last via the dist republish through `v0.9.3`; subsequent versions publish from the toolchain | Libraries publish from the repo that owns their identity; this repo only consumes their Release tarballs at build time. |
| npm `@temporal-architect/twf` + 5 platform sub-packages | yes (`_publish-npm-twf.yml`) | yes (`NPM_TOKEN`, scope claimed) | no | First publish happens on next tag. **6 packages publish atomically per tag**; if any sub-package publish fails the wrapper's `optionalDependencies` resolution breaks for that platform. |
| npm `@temporal-architect/claude-plugin` | yes (`_publish-npm-claude-plugin.yml`) | yes (`NPM_TOKEN`) | no | Claude Code marketplace plugin payload. |
| PyPI `twf-cli` (5 wheels) | yes (`_publish-pypi.yml`) | **no** (`PYPI_TOKEN` missing) | no | Account creation + package name reservation + secret pending. See [§ External accounts](#external-accounts). |
| Homebrew tap `jmbarzee/homebrew-twf` | yes (`_publish-brew.yml`) | **no** (`HOMEBREW_TAP_TOKEN` missing, tap repo not created) | no | Tap repo creation + initial `Formula/twf.rb` + secret pending. |
| Claude Code marketplace (`/plugin install temporal-architect@temporal-architect`) | n/a (resolved from GitHub) | (uses `GITHUB_TOKEN`) | no | Becomes reachable the moment the GitHub repo rename lands (or via the redirect, for a year). |
| Smithery MCP registry | n/a (manual) | n/a | n/a | Post-M2. |

Legend: "wired in CI" = a `_publish-*.yml` reusable workflow exists and is called from `release.yml`; "first publish landed" = the artifact actually exists on the public registry under the current name.

## What blocks what

```
External account setup (PyPI + Homebrew tap)
  ├── unblocks: `_publish-pypi.yml`, `_publish-brew.yml`
  └── only remaining gate — see § 1

First publish (any `v*` tag after the above)
  ├── unblocks: every "first publish landed: no" row above
  └── needs smoke tests per channel — see § 3
```

The GitHub repo rename (`jmbarzee/temporal-skills` → `jmbarzee/temporal-architect`) is **done**. GitHub auto-redirects the old URL for ~1 year of inactivity, which is enough for the long tail (forks, cached blog posts, AI-agent caches) to migrate via `git remote set-url`. The CHANGELOG entry for the next release should call this out.

---

## 1. External accounts (pending)

Both block their corresponding publish jobs. Both are independent and can be done in parallel.

### PyPI (`PYPI_TOKEN`)

1. Create an account at [pypi.org](https://pypi.org). Verify email; enable 2FA (required for new accounts).
2. (Optional) Mirror the account at [test.pypi.org](https://test.pypi.org) for dry-runs.
3. **Reserve the name `twf-cli`** by publishing `v0.0.0` from your local machine, or land it on the first real release:
   ```bash
   cd packages/pypi/twf-cli
   # Edit version to 0.0.0
   python -m build
   python -m twine upload dist/*    # interactively prompts for credentials
   ```
   Once reserved, the account is the package owner; CI can publish subsequent versions via token.
4. Generate an API token: pypi.org → Account settings → API tokens → **scoped to project `twf-cli`** (not account-wide).
5. Add to GitHub on `temporal-architect-dist` (where the publish workflows live): Settings → Secrets and variables → Actions → New repository secret → name `PYPI_TOKEN`, value the full `pypi-...` string.

### Homebrew tap (`HOMEBREW_TAP_TOKEN`)

1. **Create the tap repo** on GitHub: `jmbarzee/homebrew-twf` (the `homebrew-` prefix is required by Homebrew convention).
2. **Push an initial empty formula** so the tap is discoverable:
   ```bash
   brew tap-new jmbarzee/twf
   # populates ./Formula/twf.rb with a stub
   cd "$(brew --repo jmbarzee/twf)"
   git remote add origin git@github.com:jmbarzee/homebrew-twf.git
   git push -u origin main
   ```
   The first `bump-brew` run overwrites the stub.
3. **Create a PAT for CI**: github.com → Settings → Developer settings → Personal access tokens → Fine-grained → Repository access: only `jmbarzee/homebrew-twf` → Repository permissions: Contents (Read and write).
4. Add to GitHub repo secrets (on `temporal-architect-dist`, where the publish workflows live — not the tap): name `HOMEBREW_TAP_TOKEN`, value the PAT.

### Verification gate

- [ ] `PYPI_TOKEN` and `HOMEBREW_TAP_TOKEN` visible in `temporal-architect-dist` → Settings → Secrets and variables → Actions.
- [ ] `twf-cli` and `jmbarzee/homebrew-twf` exist on their respective public registries.

---

## 2. Pre-tag final cleanup

- [ ] CHANGELOG entry for the next version noting the GitHub repo rename and (eventually) first publish on PyPI / Homebrew / npm-twf / claude-plugin channels.

### Verification gate

- [x] No live *branding* references to the old project name in source — the storefront and docs are repositioned. Two deliberate, non-branding references remain: the `temporal-skills` LEGACY cleanup constant in `packages/vscode/src/extension.ts` (functional — it removes stale installs) and the on-disk working-tree directory name (cosmetic; the GitHub repo is already renamed). Neither is user-facing copy.

---

## 3. First-publish verification (per channel)

After the next `v*` tag fires, each channel needs a real-world smoke test. CI green is necessary but not sufficient — the registry's resolution path is what matters.

| Channel | Smoke test | Pass criterion |
|---|---|---|
| **GitHub Release assets** | `curl -sSL https://raw.githubusercontent.com/jmbarzee/temporal-architect-dist/main/packages/install.sh \| bash` in a clean shell on macOS and Linux | `twf --version` prints the matching tag |
| **npm wrapper** | `npx -y @temporal-architect/twf check examples/order.twf` from a directory with no `node_modules` | exits 0; npm resolves the correct platform sub-package |
| **npm visualizer** | In a scratch Vite app, `npm install @temporal-architect/visualizer react react-dom` → `import { Visualizer }` → `tsc --strict` | types resolve; bundle includes externalized React |
| **npm claude-plugin** | `npm view @temporal-architect/claude-plugin version` matches the tag; `/plugin install temporal-architect@temporal-architect` in Claude Code shows the skills | plugin appears in Claude Code's plugin list with the right version |
| **PyPI** | In a clean venv: `pip install twf-cli==X.Y.Z` for each of the 5 platforms (via Docker for non-host platforms); `twf --version` | exits 0; reports the right version |
| **Homebrew** | `brew untap jmbarzee/twf 2>/dev/null; brew install jmbarzee/twf/twf` on a fresh macOS shell | `twf --version` prints the tag |
| **VS Code Marketplace** | Install `jmbarzee.twf-syntax` from a fresh VS Code profile; open a `.twf` file | LSP starts, diagnostics render, visualizer opens, skills appear under `~/.cursor/skills/temporal-architect-{design,author-go}/` |
| **Open VSX** | Same, in Codium / Cursor with Open VSX registry configured | Same as VS Code Marketplace |
| **`go install`** | `GOBIN=/tmp/twf-test go install github.com/jmbarzee/temporal-architect/tools/lsp/cmd/twf@vX.Y.Z` | binary builds; `twf --version` reports the tag |

Failures here are typically credential-related (token scopes too narrow), name-reservation issues (package name not actually owned), or platform-specific wheel/sub-package gaps. The reusable workflows are designed so individual channel failures do not block other channels — see `packaging.md § C6`.

### Verification gate

- [ ] At least one passing smoke test per row above for the first post-rename `v*` tag.
- [ ] CHANGELOG updated to call out which channels went live on this tag.

---

## 4. Sequencing

1. **Stand up the PyPI and Homebrew accounts** (§ 1). The only remaining external gate.
2. **CHANGELOG entry** (§ 2) — record the GitHub rename and queued first-publish channels.
3. **Cut the next `v*` tag.** Every reusable workflow fires; per-channel smoke-test (§ 3).
4. **Triage any first-publish failures** per channel and re-tag if needed.
5. **Post-M2: Smithery submission** (per `packaging.md`).

The work above can plausibly land in one focused session plus a real-tag dry run; the only hard external dependency is account creation latency (PyPI verification + tap repo creation).
