# Distribution repo Makefile.
#
# This repo builds every end-user consumption model from the toolchain's GitHub
# Release assets (binaries, skills tarball, visualizer lib, wire-types). It
# downloads those assets, stamps the incoming version into every manifest,
# packages (CLI wrappers, VSIX + its webview bundle, claude-plugin, PyPI), and
# publishes to every registry. The toolchain (jmbarzee/temporal-architect) is
# the engine + the canonical Release and publishes its own libraries; this is
# the storefront.

# ── Configuration ────────────────────────────────────────────────────────────

SRC_REPO ?= jmbarzee/temporal-architect
VERSION  ?=
VER      := $(patsubst v%,%,$(VERSION))

ASSETS  := dist-assets
EXT_DIR := packages/vscode

# twf-serve is dist-owned Go source (built here, not downloaded); serve-ui is its
# embedded single-file UI bundle. See the "twf-serve" section below.
SERVE_DIR   := packages/twf-serve
SERVEUI_DIR := packages/serve-ui
# This repo — where the twf-serve binary is built, released, and the Homebrew
# formula points (the toolchain releases twf; dist releases twf-serve).
DIST_REPO ?= jmbarzee/temporal-architect-dist

# Sibling toolchain checkout, used by `fetch-local`/`dev` for local F5 testing
# against a live build (not a downloaded Release). Override if it lives elsewhere.
TOOLCHAIN ?= ../temporal-architect

# Local platform — defaults for the dev flow (fetch-local/dev). The release/
# publish targets always pass GOOS/GOARCH explicitly per platform, so these
# defaults only affect local-dev archive names.
GOOS   ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)

# Dev version sourced from the sibling toolchain's `git describe` (leading "v"
# stripped). The fetch-local/dev flow stamps this into the locally-built archive
# names so the SAME stage-* pipeline a real Release uses works unchanged.
DEV_VER := $(shell cd $(TOOLCHAIN) 2>/dev/null && git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' || echo dev)

# label:GOOS:GOARCH — must match the toolchain's release matrix + archive names.
PLATFORMS := \
	darwin-arm64:darwin:arm64 \
	darwin-x64:darwin:amd64 \
	linux-x64:linux:amd64 \
	linux-arm64:linux:arm64 \
	win32-x64:windows:amd64

.PHONY: require-version
require-version:
	@if [ -z "$(VER)" ]; then echo "Error: VERSION not set (e.g. make <target> VERSION=1.2.3)"; exit 1; fi

# ── Fetch + stamp ────────────────────────────────────────────────────────────

.PHONY: fetch-release stamp-committed-versions stamp-versions check-versions

## Download every asset of the toolchain's GitHub Release v<VER> into dist-assets/.
## Needs `gh` authenticated (GITHUB_TOKEN in CI).
fetch-release: require-version
	@mkdir -p $(ASSETS)
	gh release download v$(VER) -R $(SRC_REPO) -D $(ASSETS) --clobber
	@# Guardrail: the asset names are a contract with the toolchain's release
	@# matrix (see PLATFORMS). If the toolchain ever renames or drops an asset,
	@# fail here with the exact missing name instead of surfacing deep inside a
	@# later stage-* step. This is the one place the two repos are coupled.
	@missing=""; \
	for pt in $(PLATFORMS); do \
		os=$$(echo $$pt | cut -d: -f2); arch=$$(echo $$pt | cut -d: -f3); \
		if [ "$$os" = "windows" ]; then f="twf-v$(VER)-$$os-$$arch.zip"; else f="twf-v$(VER)-$$os-$$arch.tar.gz"; fi; \
		[ -f "$(ASSETS)/$$f" ] || missing="$$missing $$f"; \
	done; \
	for f in skills-v$(VER).tar.gz temporal-architect-visualizer-$(VER).tgz temporal-architect-wire-types-$(VER).tgz; do \
		[ -f "$(ASSETS)/$$f" ] || missing="$$missing $$f"; \
	done; \
	if [ -n "$$missing" ]; then echo "::error::fetch-release: missing expected Release asset(s) for v$(VER):$$missing"; exit 1; fi
	@echo "Fetched release v$(VER) assets into $(ASSETS)/"

## Stamp the incoming version into every *committed* manifest — the subset of
## edits whose result belongs in git and is the real, published version. This is
## the source of truth for prepare-release.yml, which runs this target on main
## and opens a human-gated release/v* PR; merging it bumps the committed versions
## so none is ever stale or cosmetic: marketplace.json is read from git by Claude
## Code, and the rest are kept honest for anyone reading the repo (issues #2, #11).
## Deliberately excludes the build-only rewrites (the file: tarball deps) and the
## composed descriptions (they need staged Release assets) — those are ephemeral
## to a CI checkout and must NEVER be committed; they live in stamp-versions below.
stamp-committed-versions: require-version
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' $(EXT_DIR)/package.json && rm -f $(EXT_DIR)/package.json.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/twf/package.json && rm -f packages/npm/twf/package.json.bak
	@for p in darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64; do \
		sed -i.bak "s|\"@temporal-architect/twf-$$p\": *\"[^\"]*\"|\"@temporal-architect/twf-$$p\": \"$(VER)\"|" packages/npm/twf/package.json && rm -f packages/npm/twf/package.json.bak; \
		sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/twf-$$p/package.json && rm -f packages/npm/twf-$$p/package.json.bak; \
	done
	@sed -i.bak 's/^version = "[^"]*"/version = "$(VER)"/' packages/pypi/twf-cli/pyproject.toml && rm -f packages/pypi/twf-cli/pyproject.toml.bak
	@sed -i.bak 's/^__version__ = "[^"]*"$$/__version__ = "$(VER)"/' packages/pypi/twf-cli/src/twf_cli/__init__.py && rm -f packages/pypi/twf-cli/src/twf_cli/__init__.py.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/claude-plugin/package.json && rm -f packages/npm/claude-plugin/package.json.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/g' .claude-plugin/marketplace.json && rm -f .claude-plugin/marketplace.json.bak
	@# Pin the plugin's MCP launch line to this version so the twf MCP binary and
	@# the plugin's skills always move together — no npm-latest binary running
	@# against stamped skills (issue #2). The pattern matches the bare
	@# "@temporal-architect/twf" or a prior "…twf@x.y.z" pin, never the
	@# "…twf-<platform>" subpackages (which are followed by '-', not '@' or '"').
	@sed -i.bak 's|"@temporal-architect/twf\(@[^"]*\)\{0,1\}"|"@temporal-architect/twf@$(VER)"|g' .claude-plugin/marketplace.json && rm -f .claude-plugin/marketplace.json.bak
	@# serve-ui embeds the published visualizer library; pin it to this release so
	@# the bundle go-installed at v$(VER) matches. (The Go-side tools/lsp pin needs
	@# `go get` and rides the release build, not this sed-only stamp — see
	@# pin-serve-lsp / _release-twf-serve.yml.)
	@sed -i.bak 's|"@temporal-architect/visualizer": *"[^"]*"|"@temporal-architect/visualizer": "$(VER)"|' $(SERVEUI_DIR)/package.json && rm -f $(SERVEUI_DIR)/package.json.bak
	@echo "Stamped committed version fields to $(VER)"

## Stamp everything a release build needs: the committed version fields (above)
## plus the build-only rewrites — the extension's wire-types dep repointed at the
## downloaded tarball, and each channel's composed description. Those extra edits
## point at dist-assets/ that only exists in a release checkout, so they are
## ephemeral and must never be committed (that is why prepare-release.yml runs
## stamp-committed-versions, not this target).
stamp-versions: require-version stamp-committed-versions
	@# Extension builds against the wire-types tarball downloaded from the toolchain
	@# Release (make fetch-release), NOT the npm registry — this keeps the VSIX build
	@# independent of the wire-types npm publish (same way the webview bundle is staged
	@# from a Release asset). The file: path is relative to the extension package.json.
	@sed -i.bak 's|\("@temporal-architect/wire-types": *\)"[^"]*"|\1"file:../../$(ASSETS)/temporal-architect-wire-types-$(VER).tgz"|' $(EXT_DIR)/package.json && rm -f $(EXT_DIR)/package.json.bak
	@# Descriptions are composable too: stamp each channel's `description` from the
	@# single source (docs/descriptions.json; "@global" inherits the toolchain
	@# fragment). Homebrew's desc is passed to bump-brew by publish-brew instead.
	@node docs/stamp-descriptions.mjs --assets $(ASSETS)
	@echo "Stamped manifests to $(VER)"

## Assert every dist manifest's version equals <VER>. Run after stamp-versions
## as a sanity gate that no manifest was missed.
check-versions: require-version
	@fail=0; \
	check_node() { v=$$(node -p "require('./$$2').version"); echo "  $$1: $$v"; [ "$$v" = "$(VER)" ] || { echo "::error::$$2 = $$v != $(VER)"; fail=1; }; }; \
	check_node "vscode" "$(EXT_DIR)/package.json"; \
	check_node "npm wrapper" "packages/npm/twf/package.json"; \
	for p in darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64; do check_node "npm $$p" "packages/npm/twf-$$p/package.json"; done; \
	check_node "claude plugin" "packages/npm/claude-plugin/package.json"; \
	py=$$(python3 -c "import tomllib;print(tomllib.load(open('packages/pypi/twf-cli/pyproject.toml','rb'))['project']['version'])"); echo "  pypi: $$py"; [ "$$py" = "$(VER)" ] || { echo "::error::pyproject = $$py != $(VER)"; fail=1; }; \
	mp=$$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].version"); echo "  marketplace: $$mp"; [ "$$mp" = "$(VER)" ] || { echo "::error::.claude-plugin/marketplace.json = $$mp != $(VER)"; fail=1; }; \
	mcp=$$(node -p "require('./.claude-plugin/marketplace.json').plugins[0].mcpServers.twf.args.find(a => a.indexOf('@temporal-architect/twf@') === 0)"); echo "  marketplace mcp pin: $$mcp"; [ "$$mcp" = "@temporal-architect/twf@$(VER)" ] || { echo "::error::marketplace.json MCP args pin = $$mcp != @temporal-architect/twf@$(VER)"; fail=1; }; \
	exit $$fail

# ── Stage downloaded assets into package trees ───────────────────────────────

.PHONY: stage-binary stage-skills build-webview stage-docs render-docs

## Extract the platform binary archive into the extension bin/ (for VSIX/npm/pypi).
## Usage: make stage-binary GOOS=darwin GOARCH=arm64
stage-binary: require-version
	@mkdir -p $(EXT_DIR)/bin
	@if [ "$(GOOS)" = "windows" ]; then \
		unzip -o $(ASSETS)/twf-v$(VER)-$(GOOS)-$(GOARCH).zip -d $(EXT_DIR)/bin >/dev/null; \
	else \
		tar xzf $(ASSETS)/twf-v$(VER)-$(GOOS)-$(GOARCH).tar.gz -C $(EXT_DIR)/bin; \
		chmod +x $(EXT_DIR)/bin/twf; \
	fi
	@echo "Staged twf binary for $(GOOS)/$(GOARCH)"

## Extract the skills tarball (top-level skills/ prefix) into the extension and
## the claude-plugin payload.
stage-skills: require-version
	@mkdir -p $(EXT_DIR) packages/npm/claude-plugin
	@rm -rf $(EXT_DIR)/skills packages/npm/claude-plugin/skills
	tar xzf $(ASSETS)/skills-v$(VER).tar.gz -C $(EXT_DIR)
	tar xzf $(ASSETS)/skills-v$(VER).tar.gz -C packages/npm/claude-plugin
	@echo "Staged skills"

## Build the visualizer webview IIFE bundle into the extension. The webview is a
## packaging format, not a library: we wrap the published @temporal-architect/
## visualizer library (consumed from the toolchain Release tarball, file:, so the
## VSIX build never waits on an npm publish) in the host glue and bundle a single
## IIFE the extension loads. Self-stamps the visualizer dep to the downloaded
## tarball, then installs + builds.
build-webview: require-version
	@sed -i.bak 's|\("@temporal-architect/visualizer": *\)"[^"]*"|\1"file:../../$(ASSETS)/temporal-architect-visualizer-$(VER).tgz"|' packages/webview/package.json && rm -f packages/webview/package.json.bak
	@# The dev flow reuses a constant git-describe --dirty version, so the
	@# same-named local tarball changes content between runs. npm then either
	@# skips it ("already satisfied") or trips EINTEGRITY against the committed
	@# lock, leaving a STALE visualizer (and its styles.css) in the bundle.
	@# Install the rest with the lock disabled (no integrity gate), then drop the
	@# freshly-built lib straight into node_modules ourselves so its content is
	@# always current. Release builds use unique versions and are unaffected.
	cd packages/webview && npm install --no-audit --no-fund --no-package-lock
	@rm -rf packages/webview/node_modules/@temporal-architect/visualizer
	@mkdir -p packages/webview/node_modules/@temporal-architect/visualizer
	tar xzf $(ASSETS)/temporal-architect-visualizer-$(VER).tgz -C packages/webview/node_modules/@temporal-architect/visualizer --strip-components=1
	cd packages/webview && npm run build
	@echo "Built webview bundle into $(EXT_DIR)/dist/webview"

# ── Composable docs (single source of truth) ────────────────────────────────
# Each channel's README is composed from the toolchain's canonical doc fragments
# + a per-target header template (docs/templates/). Fragments ship *inside* the
# artifacts they cover; stage-docs extracts them from the downloaded Release
# assets, render-docs assembles the listings. Generated READMEs are gitignored —
# never hand-edit them. See AGENTS.md and documentation_propagation.md.

## Extract the doc fragments (bundled inside their artifacts) + skills into
## $(ASSETS)/docs/ so render-docs can compose the listings.
stage-docs: require-version
	@rm -rf $(ASSETS)/docs && mkdir -p $(ASSETS)/docs/skills
	@# global/parser/mcp cover the binary — identical across platform archives;
	@# pull them from whichever twf-v* tarball was downloaded.
	@arch=$$(ls $(ASSETS)/twf-v$(VER)-*.tar.gz 2>/dev/null | head -1); \
	if [ -z "$$arch" ]; then echo "Error: no twf-v$(VER)-*.tar.gz in $(ASSETS)/ (run fetch-release)"; exit 1; fi; \
	tar xzf "$$arch" -C $(ASSETS)/docs --strip-components=1 docs/global.md docs/parser.md docs/mcp.md
	@# visualizer fragment — inside the published tgz (npm 'package/' prefix).
	tar xzf $(ASSETS)/temporal-architect-visualizer-$(VER).tgz -C $(ASSETS)/docs --strip-components=1 package/FRAGMENT.md
	@mv $(ASSETS)/docs/FRAGMENT.md $(ASSETS)/docs/visualizer.md
	@# skills — frontmatter blurbs from the skills tarball (top-level skills/ prefix).
	tar xzf $(ASSETS)/skills-v$(VER).tar.gz -C $(ASSETS)/docs/skills --strip-components=1
	@echo "Staged doc fragments + skills into $(ASSETS)/docs/"

## Compose every channel's README from the staged fragments + templates.
## Generated READMEs are gitignored build output.
render-docs: require-version stage-docs
	node docs/render.mjs --version $(VER) --assets $(ASSETS)
	@echo "Rendered package READMEs"

# ── Local dev intake (build sibling toolchain → dist-assets) ─────────────────

.PHONY: fetch-local dev

## Dev twin of fetch-release: build the sibling toolchain's release archives for
## the local platform and drop them into dist-assets/ — the SAME shape a real
## Release download produces, so the stage-* pipeline below works unchanged. The
## toolchain stays the only thing that builds source; this just routes its output
## into the dist intake folder. Version is the toolchain's `git describe`.
fetch-local:
	@mkdir -p $(ASSETS)
	$(MAKE) -C $(TOOLCHAIN) build-twf-archive pack-visualizer-lib pack-wire-types build-skills-archive \
		VERSION=$(DEV_VER) GOOS=$(GOOS) GOARCH=$(GOARCH)
	cp $(TOOLCHAIN)/dist/twf-v$(DEV_VER)-$(GOOS)-$(GOARCH).tar.gz $(ASSETS)/
	@# npm pack names tarballs by the package's manifest version, which need not
	@# equal the local git-describe DEV_VER; rename on copy so build-webview's
	@# file: path (…-$(DEV_VER).tgz) resolves. The tarball's internal version is
	@# untouched (npm reads contents, not filename). Pick the NEWEST match (the
	@# one this run just packed) so a dist/ that still holds older-version
	@# tarballs doesn't make the copy ambiguous.
	cp "$$(ls -t $(TOOLCHAIN)/dist/temporal-architect-visualizer-*.tgz | head -1)" $(ASSETS)/temporal-architect-visualizer-$(DEV_VER).tgz
	cp "$$(ls -t $(TOOLCHAIN)/dist/temporal-architect-wire-types-*.tgz | head -1)" $(ASSETS)/temporal-architect-wire-types-$(DEV_VER).tgz
	cp $(TOOLCHAIN)/dist/skills-v$(DEV_VER).tar.gz $(ASSETS)/
	@echo "Copied local toolchain archives into $(ASSETS)/ (v$(DEV_VER))"

## One command to test the extension against a live build. Builds + copies the
## toolchain archives into dist-assets/ (fetch-local), then runs the identical
## stage-* pipeline a Release uses and compiles the extension TS. The whole F5
## prep — the target behind the "Run Extension (Local Toolchain)" launch config.
## Assumes the extension's node_modules are installed (`cd $(EXT_DIR) && npm install`).
dev: fetch-local
	$(MAKE) stage-binary build-webview stage-skills VERSION=$(DEV_VER) GOOS=$(GOOS) GOARCH=$(GOARCH)
	cd $(EXT_DIR) && npm run compile
	@echo "Extension ready — launch with F5 (Run Extension)"

# ── VSIX (VS Code / Cursor / Open VSX) ───────────────────────────────────────

.PHONY: build-extension package-platform publish-vscode publish-ovsx

## Compile the extension TS against the published wire-types (+ staged webview/skills).
build-extension: require-version
	cd $(EXT_DIR) && npm install --no-audit --no-fund && npm run compile
	@echo "Compiled extension"

## Package a single-platform VSIX. Stages the binary first.
## Usage: make package-platform VSCE_TARGET=darwin-arm64 GOOS=darwin GOARCH=arm64
package-platform: require-version stage-binary render-docs
	cd $(EXT_DIR) && npx @vscode/vsce package --target $(VSCE_TARGET)
	@echo "Packaged VSIX for $(VSCE_TARGET)"

## Publish all platform VSIXes to VS Code Marketplace.
publish-vscode:
	@if [ -z "$(VSCE_TOKEN)" ]; then echo "Error: VSCE_TOKEN not set"; exit 1; fi
	@for vsix in $(EXT_DIR)/*.vsix; do \
		echo "Publishing $$vsix to VS Code Marketplace..."; \
		(cd $(EXT_DIR) && npx @vscode/vsce publish --packagePath $$(basename $$vsix) -p $(VSCE_TOKEN)); \
	done

## Publish all platform VSIXes to Open VSX.
publish-ovsx:
	@if [ -z "$(OVSX_TOKEN)" ]; then echo "Error: OVSX_TOKEN not set"; exit 1; fi
	@for vsix in $(EXT_DIR)/*.vsix; do \
		echo "Publishing $$vsix to Open VSX..."; \
		npx ovsx publish $$vsix -p $(OVSX_TOKEN); \
	done

# ── npm wrapper + platform sub-packages ──────────────────────────────────────

.PHONY: publish-npm-platform publish-npm

## Stage the downloaded binary into one platform sub-package and `npm publish`.
## Usage: make publish-npm-platform VSCE_TARGET=darwin-arm64 GOOS=darwin GOARCH=arm64
publish-npm-platform: require-version stage-binary
	@ext=""; if [ "$(GOOS)" = "windows" ]; then ext=".exe"; fi; \
		mkdir -p packages/npm/twf-$(VSCE_TARGET)/bin; \
		cp $(EXT_DIR)/bin/twf$$ext packages/npm/twf-$(VSCE_TARGET)/bin/twf$$ext
	cd packages/npm/twf-$(VSCE_TARGET) && npm publish --provenance

## Publish the @temporal-architect/twf wrapper (AFTER all sub-packages exist).
## --provenance: published via trusted publishing (OIDC) in CI; the in-repo
## package's repository.url matches this repo. (Local runs without CI OIDC will
## fail provenance — these targets are CI publish targets.)
## render-docs regenerates the (gitignored) README that npm ships.
publish-npm: render-docs
	cd packages/npm/twf && npm publish --provenance

# ── PyPI wheel ───────────────────────────────────────────────────────────────

.PHONY: build-pypi-wheel publish-pypi

## Stage the downloaded binary into the PyPI package and build one platform wheel.
## Usage: make build-pypi-wheel PLATFORM_TAG=macosx_11_0_arm64 GOOS=darwin GOARCH=arm64
build-pypi-wheel: require-version stage-binary render-docs
	@if [ -z "$(PLATFORM_TAG)" ]; then echo "Error: PLATFORM_TAG not set"; exit 1; fi
	@mkdir -p packages/pypi/twf-cli/src/twf_cli/_binary
	@ext=""; if [ "$(GOOS)" = "windows" ]; then ext=".exe"; fi; \
		cp $(EXT_DIR)/bin/twf$$ext packages/pypi/twf-cli/src/twf_cli/_binary/twf$$ext; \
		chmod +x packages/pypi/twf-cli/src/twf_cli/_binary/twf$$ext 2>/dev/null || true
	cd packages/pypi/twf-cli && rm -rf dist && python3 -m build --wheel
	cd packages/pypi/twf-cli/dist && python3 -m wheel tags --remove --platform-tag $(PLATFORM_TAG) *.whl
	@echo "Built wheel for $(PLATFORM_TAG)"

## Upload all built wheels to PyPI via twine.
publish-pypi:
	@if [ -z "$(TWINE_PASSWORD)" ]; then echo "Error: TWINE_PASSWORD not set"; exit 1; fi
	twine upload --non-interactive packages/pypi/twf-cli/dist/*.whl

# ── Claude Code plugin ───────────────────────────────────────────────────────

.PHONY: build-claude-plugin publish-npm-claude-plugin stage-agents

## Stage the plugin's `agents/` payload from the canonical subagent definitions
## that ship inside the skills tarball — single-sourced in the toolchain repo
## (temporal-architect#140), so the plugin agents never drift from the reference
## docs. Runs after stage-skills, which extracts the skills tree this reads from.
stage-agents: stage-skills
	@mkdir -p packages/npm/claude-plugin/agents
	@rm -f packages/npm/claude-plugin/agents/*.md
	@src=packages/npm/claude-plugin/skills/temporal-architect-design/subagents; \
	if [ ! -d "$$src" ]; then \
		echo "Error: $$src not found — the staged skills tarball has no subagents/ (needs a toolchain release >= v0.12.0, which ships temporal-architect#140)"; \
		exit 1; \
	fi; \
	cp "$$src"/project-discovery.md "$$src"/slice-mapper.md packages/npm/claude-plugin/agents/
	@echo "Staged claude-plugin agents"

## Stage skills + agents into the claude-plugin package (from the downloaded
## skills tarball) and compose its README from the doc fragments.
build-claude-plugin: stage-skills stage-agents render-docs

## Publish @temporal-architect/claude-plugin to npm.
## (The reusable workflow publishes inline with --provenance; kept in sync here.)
publish-npm-claude-plugin: build-claude-plugin
	cd packages/npm/claude-plugin && npm publish --provenance

# The visualizer + wire-types libraries are published to npm by the TOOLCHAIN
# repo (where their source and repository.url live, so provenance succeeds). This
# repo only consumes their Release tarballs at build time (VSIX types + webview).

# ── Homebrew tap ─────────────────────────────────────────────────────────────

.PHONY: publish-brew

## Bump jmbarzee/homebrew-twf's Formula/twf.rb to this version's Release archives.
## Required env: HOMEBREW_TAP_TOKEN.
publish-brew: require-version
	@if [ -z "$(HOMEBREW_TAP_TOKEN)" ]; then echo "Error: HOMEBREW_TAP_TOKEN not set"; exit 1; fi
	@desc=$$(node -p "require('./docs/descriptions.json').homebrew"); \
	cd internal/release/bump-brew && go run . -version v$(VER) -source $(SRC_REPO) -token $(HOMEBREW_TAP_TOKEN) -desc "$$desc"

# ── twf-serve (Go binary BUILT here, not downloaded) ─────────────────────────
#
# Unlike every other channel, twf-serve is dist-owned SOURCE, not a repackaging
# of a toolchain binary: it imports the toolchain's tools/lsp/pipeline as a
# library (in-process, no subprocess) and embeds the serve-ui single-file bundle.
# So this repo CROSS-COMPILES it — the one place dist builds Go — rather than
# downloading a prebuilt archive via fetch-release. Archive names mirror the
# toolchain's (`twf-serve-v$(VER)-<os>-<arch>.{tar.gz,zip}`) so the same PLATFORMS
# matrix, Homebrew formula shape, and Release-asset conventions carry over.

.PHONY: build-serve-ui build-twf-serve-archive twf-serve-archives pin-serve-lsp publish-brew-serve

## Build the single-file visualizer bundle twf-serve embeds. Regenerates
## $(SERVE_DIR)/ui/index.html — committed (NOT gitignored like the webview
## bundle) so `go install`/`go build` of the module always has an asset to embed
## (the module proxy cannot run vite). Run once before cross-compiling.
build-serve-ui:
	cd $(SERVEUI_DIR) && npm ci && npm run build

## Cross-compile + archive twf-serve for ONE platform into $(ASSETS). Assumes the
## serve-ui bundle is already built (does not rebuild it per platform).
## Usage: make build-twf-serve-archive VERSION=1.2.3 GOOS=darwin GOARCH=arm64
build-twf-serve-archive: require-version
	@mkdir -p $(ASSETS) $(SERVE_DIR)/dist
	@ext=""; [ "$(GOOS)" = "windows" ] && ext=".exe"; \
	( cd $(SERVE_DIR) && CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) \
		go build -trimpath -ldflags "-s -w -X main.version=$(VER)" -o "dist/twf-serve$$ext" . ); \
	if [ "$(GOOS)" = "windows" ]; then \
		( cd $(SERVE_DIR)/dist && zip -q "twf-serve-v$(VER)-$(GOOS)-$(GOARCH).zip" "twf-serve$$ext" ); \
		mv "$(SERVE_DIR)/dist/twf-serve-v$(VER)-$(GOOS)-$(GOARCH).zip" "$(ASSETS)/"; \
	else \
		tar -C "$(SERVE_DIR)/dist" -czf "$(ASSETS)/twf-serve-v$(VER)-$(GOOS)-$(GOARCH).tar.gz" "twf-serve"; \
	fi; \
	echo "Archived twf-serve-v$(VER)-$(GOOS)-$(GOARCH)"

## Build the bundle once, then cross-compile + archive twf-serve for every
## platform in PLATFORMS. Produces $(ASSETS)/twf-serve-v$(VER)-*.{tar.gz,zip} —
## the assets the dist GitHub Release ships and the Homebrew formula points at.
twf-serve-archives: require-version build-serve-ui
	@for pt in $(PLATFORMS); do \
		os=$$(echo $$pt | cut -d: -f2); arch=$$(echo $$pt | cut -d: -f3); \
		$(MAKE) build-twf-serve-archive VERSION=$(VER) GOOS=$$os GOARCH=$$arch || exit 1; \
	done

## Pin twf-serve's in-process pipeline dep (tools/lsp) to this release's toolchain
## module tag, updating go.mod + go.sum atomically. Requires Go + network, so it
## rides the release build (not the sed-only stamp-committed-versions — which
## already pins serve-ui's visualizer npm dep). Together they make a
## `go install …/twf-serve@vVER` see a tree whose embedded UI and in-process
## pipeline both match the toolchain release v$(VER).
pin-serve-lsp: require-version
	cd $(SERVE_DIR) && go get github.com/jmbarzee/temporal-architect/tools/lsp@v$(VER) && go mod tidy

## Bump the tap's Formula/twf-serve.rb to this version's DIST Release archives.
## twf-serve is built + released by THIS repo (not the toolchain), so -source is
## the dist repo. Required env: HOMEBREW_TAP_TOKEN.
publish-brew-serve: require-version
	@if [ -z "$(HOMEBREW_TAP_TOKEN)" ]; then echo "Error: HOMEBREW_TAP_TOKEN not set"; exit 1; fi
	@desc=$$(node -p "require('./docs/descriptions.json')['homebrew-serve'] || 'Live temporal-architect visualizer over local HTTP (twf-serve)'"); \
	cd internal/release/bump-brew && go run . -name twf-serve -version v$(VER) -source $(DIST_REPO) -token $(HOMEBREW_TAP_TOKEN) -desc "$$desc"

# ── Clean ────────────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	rm -rf $(ASSETS) $(EXT_DIR)/bin $(EXT_DIR)/dist $(EXT_DIR)/out $(EXT_DIR)/skills $(EXT_DIR)/*.vsix
	rm -rf packages/webview/node_modules
	rm -rf packages/npm/twf-*/bin packages/npm/twf*/LICENSE packages/npm/claude-plugin/skills
	rm -rf packages/pypi/twf-cli/dist packages/pypi/twf-cli/src/twf_cli/_binary
	rm -rf $(SERVE_DIR)/dist $(SERVEUI_DIR)/node_modules
	@# Generated (gitignored) package READMEs composed by render-docs.
	rm -f packages/vscode/README.md packages/npm/twf/README.md packages/pypi/twf-cli/README.md packages/npm/claude-plugin/README.md
	@echo "Cleaned"
