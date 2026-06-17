# Distribution repo Makefile.
#
# This repo does NO source build. It downloads the toolchain's GitHub Release
# assets (binaries, skills tarball, visualizer lib/webview, wire-types), stamps
# the incoming version into every manifest, repackages, and publishes to every
# registry. The toolchain (jmbarzee/temporal-architect) is the engine + the
# canonical Release; this is the storefront.

# ── Configuration ────────────────────────────────────────────────────────────

SRC_REPO ?= jmbarzee/temporal-architect
VERSION  ?=
VER      := $(patsubst v%,%,$(VERSION))

ASSETS  := dist-assets
EXT_DIR := packages/vscode

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

.PHONY: fetch-release stamp-versions check-versions

## Download every asset of the toolchain's GitHub Release v<VER> into dist-assets/.
## Needs `gh` authenticated (GITHUB_TOKEN in CI).
fetch-release: require-version
	@mkdir -p $(ASSETS)
	gh release download v$(VER) -R $(SRC_REPO) -D $(ASSETS) --clobber
	@echo "Fetched release v$(VER) assets into $(ASSETS)/"

## Stamp the incoming version into every dist manifest (build-time lockstep —
## dist never tags; the version is the one carried in the dispatch payload).
stamp-versions: require-version
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' $(EXT_DIR)/package.json && rm -f $(EXT_DIR)/package.json.bak
	@# Extension's published wire-types dependency pin -> the matching release.
	@sed -i.bak 's|\("@temporal-architect/wire-types": *\)"[^"]*"|\1"$(VER)"|' $(EXT_DIR)/package.json && rm -f $(EXT_DIR)/package.json.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/twf/package.json && rm -f packages/npm/twf/package.json.bak
	@for p in darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64; do \
		sed -i.bak "s|\"@temporal-architect/twf-$$p\": *\"[^\"]*\"|\"@temporal-architect/twf-$$p\": \"$(VER)\"|" packages/npm/twf/package.json && rm -f packages/npm/twf/package.json.bak; \
		sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/twf-$$p/package.json && rm -f packages/npm/twf-$$p/package.json.bak; \
	done
	@sed -i.bak 's/^version = "[^"]*"/version = "$(VER)"/' packages/pypi/twf-cli/pyproject.toml && rm -f packages/pypi/twf-cli/pyproject.toml.bak
	@sed -i.bak 's/^__version__ = "[^"]*"$$/__version__ = "$(VER)"/' packages/pypi/twf-cli/src/twf_cli/__init__.py && rm -f packages/pypi/twf-cli/src/twf_cli/__init__.py.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/' packages/npm/claude-plugin/package.json && rm -f packages/npm/claude-plugin/package.json.bak
	@sed -i.bak 's/"version": *"[^"]*"/"version": "$(VER)"/g' .claude-plugin/marketplace.json && rm -f .claude-plugin/marketplace.json.bak
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
	exit $$fail

# ── Stage downloaded assets into package trees ───────────────────────────────

.PHONY: stage-binary stage-skills stage-webview

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

## Extract the visualizer webview bundle into the extension.
stage-webview: require-version
	@mkdir -p $(EXT_DIR)/dist/webview
	tar xzf $(ASSETS)/visualizer-webview-v$(VER).tar.gz -C $(EXT_DIR)/dist/webview
	@echo "Staged webview bundle"

# ── VSIX (VS Code / Cursor / Open VSX) ───────────────────────────────────────

.PHONY: build-extension package-platform publish-vscode publish-ovsx

## Compile the extension TS against the published wire-types (+ staged webview/skills).
build-extension: require-version
	cd $(EXT_DIR) && npm install --no-audit --no-fund && npm run compile
	@echo "Compiled extension"

## Package a single-platform VSIX. Stages the binary first.
## Usage: make package-platform VSCE_TARGET=darwin-arm64 GOOS=darwin GOARCH=arm64
package-platform: require-version stage-binary
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
	cd packages/npm/twf-$(VSCE_TARGET) && npm publish

## Publish the @temporal-architect/twf wrapper (AFTER all sub-packages exist).
publish-npm:
	cd packages/npm/twf && npm publish

# ── PyPI wheel ───────────────────────────────────────────────────────────────

.PHONY: build-pypi-wheel publish-pypi

## Stage the downloaded binary into the PyPI package and build one platform wheel.
## Usage: make build-pypi-wheel PLATFORM_TAG=macosx_11_0_arm64 GOOS=darwin GOARCH=arm64
build-pypi-wheel: require-version stage-binary
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

.PHONY: build-claude-plugin publish-npm-claude-plugin

## Stage skills into the claude-plugin package (from the downloaded skills tarball).
build-claude-plugin: stage-skills

## Publish @temporal-architect/claude-plugin to npm.
publish-npm-claude-plugin: build-claude-plugin
	cd packages/npm/claude-plugin && npm publish

# ── Re-publish prebuilt toolchain tarballs (no build) ────────────────────────

.PHONY: publish-visualizer publish-wire-types

## Publish the visualizer lib tarball downloaded from the toolchain Release.
publish-visualizer: require-version
	npm publish --access public $(ASSETS)/temporal-architect-visualizer-$(VER).tgz

## Publish the wire-types tarball downloaded from the toolchain Release.
publish-wire-types: require-version
	npm publish --access public $(ASSETS)/temporal-architect-wire-types-$(VER).tgz

# ── Homebrew tap ─────────────────────────────────────────────────────────────

.PHONY: publish-brew

## Bump jmbarzee/homebrew-twf's Formula/twf.rb to this version's Release archives.
## Required env: HOMEBREW_TAP_TOKEN.
publish-brew: require-version
	@if [ -z "$(HOMEBREW_TAP_TOKEN)" ]; then echo "Error: HOMEBREW_TAP_TOKEN not set"; exit 1; fi
	cd internal/release/bump-brew && go run . -version v$(VER) -source $(SRC_REPO) -token $(HOMEBREW_TAP_TOKEN)

# ── Clean ────────────────────────────────────────────────────────────────────

.PHONY: clean
clean:
	rm -rf $(ASSETS) $(EXT_DIR)/bin $(EXT_DIR)/dist $(EXT_DIR)/out $(EXT_DIR)/skills $(EXT_DIR)/*.vsix
	rm -rf packages/npm/twf-*/bin packages/npm/twf*/LICENSE packages/npm/claude-plugin/skills
	rm -rf packages/pypi/twf-cli/dist packages/pypi/twf-cli/src/twf_cli/_binary
	@echo "Cleaned"
