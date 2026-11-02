import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
// The shared toolchain-interpretation module: runs the `twf` CLI over a .twf
// file set and assembles the visualizer wire payload ({ ast, parserGraph,
// decomposition }). Also consumed by @temporal-architect/serve, so the two
// subprocess hosts share one implementation instead of drifting copies.
import {
  buildPayload,
  readObservedGraph,
  type DecomposeOptions,
} from "@temporal-architect/payload";

const copyFileAsync = promisify(fs.copyFile);

let client: LanguageClient | undefined;
// Track the last active text editor for returning focus after webview clicks
let lastActiveTextEditor: vscode.TextEditor | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Add bundled bin/ to terminal PATH so `twf` is available to users and AI agents
  setupTerminalPath(context);

  // Symlink bundled `twf` into ~/.local/bin so AI agent shells (which don't
  // inherit the integrated terminal's PATH) can resolve it without `go install`,
  // then auto-register the `twf mcp` server in ~/.cursor/mcp.json (which prefers
  // that stable link path). Chained so the link exists before we point at it.
  linkTwfOnPath(context).then(async () => {
    const result = await registerMcpServer(context);
    if (result === "created") {
      vscode.window.showInformationMessage(
        "Temporal Architect: registered the twf MCP server in ~/.cursor/mcp.json. Reload the window to connect it."
      );
    }
  });

  // Install bundled skills to ~/.cursor/skills/
  installSkills(context);

  // Start LSP client (uses bundled binary by default)
  startLanguageClient(context);

  // Track the last active text editor (before webview takes focus)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastActiveTextEditor = editor;
      }
    })
  );

  // Register install skills command
  const installSkillsCommand = vscode.commands.registerCommand(
    "twf.installSkills",
    async () => {
      try {
        await installSkills(context);
        const cursorSkillsDir = path.join(os.homedir(), ".cursor", "skills");
        vscode.window.showInformationMessage(
          `Temporal Architect skills installed to ${cursorSkillsDir}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to install skills: ${msg}`);
      }
    }
  );
  context.subscriptions.push(installSkillsCommand);

  // Register MCP-server registration command (manual re-run; bypasses the
  // twf.mcp.autoRegister setting since it is an explicit user action).
  const registerMcpCommand = vscode.commands.registerCommand(
    "twf.registerMcpServer",
    async () => {
      try {
        const result = await registerMcpServer(context, { force: true });
        const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");
        switch (result) {
          case "created":
          case "updated":
            vscode.window.showInformationMessage(
              `Temporal Architect: registered the twf MCP server in ${mcpPath}. Reload the window to connect it.`
            );
            break;
          case "unchanged":
            vscode.window.showInformationMessage(
              `Temporal Architect: the twf MCP server is already registered in ${mcpPath}.`
            );
            break;
          case "user-owned":
            vscode.window.showWarningMessage(
              `A \`twf\` MCP server you configured already exists in ${mcpPath}; leaving it untouched.`
            );
            break;
          case "unparseable":
            vscode.window.showErrorMessage(
              `Could not parse ${mcpPath}; left it untouched.`
            );
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to register MCP server: ${msg}`);
      }
    }
  );
  context.subscriptions.push(registerMcpCommand);

  // Register visualize file command
  const visualizeCommand = vscode.commands.registerCommand(
    "twf.visualize",
    async (uri?: vscode.Uri) => {
      // If called from explorer context menu, use the URI
      if (uri) {
        await WorkflowVisualizerPanel.createOrShowForFile(context.extensionUri, uri.fsPath);
        return;
      }

      // Otherwise use active editor
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "twf") {
        vscode.window.showWarningMessage("Please open a .twf file to visualize");
        return;
      }
      await WorkflowVisualizerPanel.createOrShowForFile(context.extensionUri, editor.document.uri.fsPath);
    }
  );

  // Register visualize folder command
  const visualizeFolderCommand = vscode.commands.registerCommand(
    "twf.visualizeFolder",
    async (uri?: vscode.Uri) => {
      let folderPath: string | undefined;

      if (uri) {
        folderPath = uri.fsPath;
      } else {
        // Prompt user to select a folder
        const folders = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: "Select folder containing .twf files",
        });
        if (folders && folders.length > 0) {
          folderPath = folders[0].fsPath;
        }
      }

      if (!folderPath) {
        return;
      }

      // Find all .twf files in the folder
      const pattern = new vscode.RelativePattern(folderPath, "**/*.twf");
      const uris = await vscode.workspace.findFiles(pattern);

      if (uris.length === 0) {
        // No .twf design files. Fall back to sampler-output detection: the
        // sampler writes a single observed-graph JSON (the deployment graph
        // reconstructed from live history), which the visualizer renders as a
        // graph-only (history-mode) view.
        const observedUris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folderPath, "**/observed-graph.json")
        );
        if (observedUris.length > 0) {
          // Prefer the shallowest match if several exist under the folder.
          const observedFile = observedUris
            .map((u) => u.fsPath)
            .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)[0];
          await WorkflowVisualizerPanel.createOrShowForHistory(context.extensionUri, observedFile);
          return;
        }
        vscode.window.showWarningMessage(
          "No .twf files or sampler output (observed-graph.json) found in the selected folder"
        );
        return;
      }

      const files = uris.map((u) => u.fsPath);
      // No focused file - show all workflows. _setFiles canonicalizes + dedupes.
      await WorkflowVisualizerPanel.createOrShowForFolder(context.extensionUri, folderPath, files, undefined);
    }
  );

  context.subscriptions.push(visualizeCommand);
  context.subscriptions.push(visualizeFolderCommand);

  // Watch for document changes to update visualization
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "twf") {
        WorkflowVisualizerPanel.refreshIfVisible();
      }
    })
  );

  // Watch for active editor changes to update focused file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "twf") {
        WorkflowVisualizerPanel.updateFocusedFile(editor.document.uri.fsPath);
      }
    })
  );
}

/**
 * Resolve the path to the twf binary.
 * Priority: user config > bundled binary > system PATH.
 */
function resolveTwfBinary(context: vscode.ExtensionContext): string {
  const config = vscode.workspace.getConfiguration("twf.lsp");
  const configPath = config.get<string>("path", "");
  if (configPath) {
    return configPath;
  }

  // Check for bundled binary
  const ext = process.platform === "win32" ? ".exe" : "";
  const bundled = path.join(context.extensionPath, "bin", `twf${ext}`);
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  // Fall back to system PATH
  return "twf";
}

/**
 * Add the extension's bin/ directory to the integrated terminal PATH.
 * This makes `twf` available to both the user and AI agents.
 */
function setupTerminalPath(context: vscode.ExtensionContext) {
  const binDir = path.join(context.extensionPath, "bin");
  if (fs.existsSync(binDir)) {
    context.environmentVariableCollection.prepend(
      "PATH",
      binDir + path.delimiter
    );
  }
}

// globalState key recording the ~/.local/bin/twf entry this extension manages.
// It is how we distinguish a link we created (safe to refresh) from a `twf` the
// user placed there themselves (must never be clobbered).
const TWF_PATH_LINK_KEY = "twf.pathLinkTarget";

/**
 * Link the bundled `twf` into ~/.local/bin so it resolves on the agent's PATH.
 *
 * `setupTerminalPath` only reaches the integrated terminal via
 * `environmentVariableCollection`; an AI agent's shell does not inherit that,
 * so extension-only users (no `go install`) get an agent that can't find `twf`.
 * `~/.local/bin` is already on the typical agent PATH (it also holds `claude`)
 * and is the installer's default `INSTALL_DIR`.
 *
 * Refreshes on every activation so the link tracks the bundled binary's
 * version. Never clobbers a user-managed `twf`: an existing entry we didn't
 * record in globalState is left untouched.
 */
async function linkTwfOnPath(context: vscode.ExtensionContext) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const bundled = path.join(context.extensionPath, "bin", `twf${ext}`);
  if (!fs.existsSync(bundled)) {
    return;
  }

  const binDir = path.join(os.homedir(), ".local", "bin");
  const target = path.join(binDir, `twf${ext}`);
  const owned = context.globalState.get<string>(TWF_PATH_LINK_KEY) === target;

  try {
    let exists = true;
    try {
      fs.lstatSync(target);
    } catch {
      exists = false;
    }

    // Leave a `twf` we didn't create (user `go install`, another tool) alone.
    if (exists && !owned) {
      console.warn(`twf already present at ${target}; leaving it untouched`);
      return;
    }

    fs.mkdirSync(binDir, { recursive: true });
    // Refresh so the entry always points at the current bundled binary.
    fs.rmSync(target, { force: true });
    if (process.platform === "win32") {
      // Symlinks require elevation on Windows; copy instead.
      await copyFileAsync(bundled, target);
    } else {
      fs.symlinkSync(bundled, target);
    }
    await context.globalState.update(TWF_PATH_LINK_KEY, target);
  } catch (err) {
    console.warn("Failed to link twf onto PATH:", err);
  }
}

// Name under which the bundled server is registered in ~/.cursor/mcp.json, and
// the globalState marker recording that this extension created that entry. As
// with TWF_PATH_LINK_KEY, the marker lets us refresh our own entry while never
// clobbering a `twf` server the user configured themselves.
const MCP_SERVER_NAME = "twf";
const TWF_MCP_OWNED_KEY = "twf.mcpServerOwned";

type McpRegisterResult =
  | "created"
  | "updated"
  | "unchanged"
  | "disabled"
  | "user-owned"
  | "unparseable"
  | "error";

/**
 * Auto-register the bundled `twf mcp` server in Cursor's ~/.cursor/mcp.json so
 * the agent can call the parser tools without the user hand-editing MCP config.
 *
 * Mirrors linkTwfOnPath's ownership model: we only create or refresh an entry we
 * own (recorded in globalState); a `twf` server the user added themselves is
 * left untouched. The write merges into the existing file (preserving other
 * servers and top-level keys) and is idempotent — it rewrites only when the
 * registered command path changes (e.g. across upgrades).
 *
 * This targets Cursor's ~/.cursor/mcp.json (the same ~/.cursor convention the
 * skills install uses). VS Code's native MCP provider API is a separate, larger
 * integration tracked in the dist BACKLOG.
 *
 * opts.force bypasses the twf.mcp.autoRegister setting for the explicit
 * "Register MCP Server" command.
 */
async function registerMcpServer(
  context: vscode.ExtensionContext,
  opts?: { force?: boolean }
): Promise<McpRegisterResult> {
  const autoRegister = vscode.workspace
    .getConfiguration("twf.mcp")
    .get<boolean>("autoRegister", true);
  if (!autoRegister && !opts?.force) {
    return "disabled";
  }

  // Prefer the stable ~/.local/bin/twf link this extension manages (refreshed to
  // the current bundled binary on every activation) so the registered path
  // survives upgrades without rewriting mcp.json; fall back to the resolved
  // (config > bundled > PATH) command.
  const ext = process.platform === "win32" ? ".exe" : "";
  const linkTarget = path.join(os.homedir(), ".local", "bin", `twf${ext}`);
  const command =
    context.globalState.get<string>(TWF_PATH_LINK_KEY) === linkTarget &&
    fs.existsSync(linkTarget)
      ? linkTarget
      : resolveTwfBinary(context);

  const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");

  try {
    let config: Record<string, any> = {};
    if (fs.existsSync(mcpPath)) {
      const raw = fs.readFileSync(mcpPath, "utf8").trim();
      if (raw) {
        try {
          config = JSON.parse(raw);
        } catch (err) {
          // Never clobber a file we cannot parse (hand-edited, comments, etc.).
          console.warn(
            `twf: could not parse ${mcpPath}; skipping MCP auto-registration`,
            err
          );
          return "unparseable";
        }
      }
    }
    if (typeof config !== "object" || config === null) {
      config = {};
    }
    if (typeof config.mcpServers !== "object" || config.mcpServers === null) {
      config.mcpServers = {};
    }

    const existing = config.mcpServers[MCP_SERVER_NAME];
    const owned = context.globalState.get<boolean>(TWF_MCP_OWNED_KEY) === true;

    // Leave a `twf` server the user configured themselves untouched.
    if (existing && !owned) {
      return "user-owned";
    }

    const desired = { command, args: ["mcp"] };
    const unchanged =
      existing &&
      existing.command === desired.command &&
      Array.isArray(existing.args) &&
      existing.args.length === 1 &&
      existing.args[0] === "mcp";

    if (unchanged) {
      await context.globalState.update(TWF_MCP_OWNED_KEY, true);
      return "unchanged";
    }

    const firstTime = !existing;
    config.mcpServers[MCP_SERVER_NAME] = desired;
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
    await context.globalState.update(TWF_MCP_OWNED_KEY, true);

    return firstTime ? "created" : "updated";
  } catch (err) {
    console.warn("Failed to register twf MCP server:", err);
    return "error";
  }
}

// Skill folders to remove from ~/.cursor/skills on activation so upgrading
// users don't keep stale duplicates. Covers folders created by older versions
// of this extension (before skills were renamed to their canonical
// `temporal-architect-*` names) and the `temporal-skills/` namespace from
// early manual installs of the repo's skills tree. Removal is recursive, so
// `temporal-skills` clears its nested `design` / `author-go` copies too.
const LEGACY_SKILL_DIRS = [
  "temporal-design",
  "temporal-author-go",
  "temporal-skills",
];

/**
 * Install bundled skills to ~/.cursor/skills/.
 *
 * Auto-discovers all skill directories containing SKILL.md in the extension
 * bundle. The bundle directory name is the canonical skill name and becomes the
 * installed folder name verbatim — Cursor uses the folder name as the skill's
 * identity (it must match the SKILL.md `name` frontmatter), so no prefixing.
 *
 * Reconciles on every activation: removes legacy folders from prior versions
 * and does a fresh copy of each skill (clearing any previous install) so files
 * dropped from the bundle don't linger in the user's copy.
 */
async function installSkills(context: vscode.ExtensionContext) {
  const bundledSkillsDir = path.join(context.extensionPath, "skills");
  if (!fs.existsSync(bundledSkillsDir)) {
    return;
  }

  const cursorSkillsDir = path.join(os.homedir(), ".cursor", "skills");

  try {
    // Drop skill folders this extension created under older names.
    for (const legacy of LEGACY_SKILL_DIRS) {
      fs.rmSync(path.join(cursorSkillsDir, legacy), {
        recursive: true,
        force: true,
      });
    }

    // Discover all skill directories (each contains a SKILL.md)
    const entries = fs.readdirSync(bundledSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillSrc = path.join(bundledSkillsDir, entry.name);
      const skillMd = path.join(skillSrc, "SKILL.md");
      if (!fs.existsSync(skillMd)) {
        continue;
      }

      // Fresh copy: clear any prior install of this skill first so files
      // removed from the bundle don't survive in the user's copy.
      const skillDest = path.join(cursorSkillsDir, entry.name);
      fs.rmSync(skillDest, { recursive: true, force: true });
      await copyDirRecursive(skillSrc, skillDest);
    }
  } catch (err) {
    console.warn("Failed to install skills:", err);
  }
}

/**
 * Recursively copy a directory, creating destinations as needed.
 */
async function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFileAsync(srcPath, destPath);
    }
  }
}

/**
 * Canonicalize and deduplicate a list of file paths.
 *
 * Paths coming from different sources (vscode.workspace.findFiles vs
 * editor.document.uri.fsPath vs a saved URI) can refer to the same file
 * while being non-equal strings — differing in case on case-insensitive
 * filesystems, in symlink resolution, or in path separator normalization.
 * Without deduplication the parser is invoked twice on the same file and
 * every definition appears twice downstream in the visualizer.
 */
function dedupeFilePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const caseInsensitive =
    process.platform === "darwin" || process.platform === "win32";
  for (const p of paths) {
    let canonical: string;
    try {
      canonical = fs.realpathSync.native(p);
    } catch {
      canonical = path.resolve(p);
    }
    if (caseInsensitive) {
      canonical = canonical.toLowerCase();
    }
    if (seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    out.push(p);
  }
  return out;
}

function startLanguageClient(context: vscode.ExtensionContext) {
  const command = resolveTwfBinary(context);

  const serverOptions: ServerOptions = {
    run: { command, args: ["lsp"] } as Executable,
    debug: { command, args: ["lsp"] } as Executable,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "twf" }],
    outputChannelName: "TWF Language Server",
  };

  client = new LanguageClient(
    "twf-lsp",
    "TWF Language Server",
    serverOptions,
    clientOptions
  );

  client.start().catch((err) => {
    vscode.window.showWarningMessage(
      `Failed to start TWF language server: ${err.message}. ` +
      `The extension bundles a twf binary; if it is missing, reinstall the extension ` +
      `or install twf with: curl -fsSL https://raw.githubusercontent.com/jmbarzee/temporal-architect-dist/main/packages/install.sh | sh`
    );
  });

  context.subscriptions.push({
    dispose: () => {
      if (client) {
        client.stop();
      }
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}

/**
 * Manages workflow visualizer webview panels
 */
class WorkflowVisualizerPanel {
  public static currentPanel: WorkflowVisualizerPanel | undefined;
  public static readonly viewType = "twfVisualizer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _folderPath: string;
  private _files: string[] = [];
  private _focusedFile: string | undefined;
  // When set, the panel renders the sampler's observed-graph JSON at this path
  // instead of parsing .twf files. Mutually exclusive with the .twf file mode:
  // history mode has no AST, so the Graph view is the only view (see the
  // visualizer's history mode).
  private _historyFile: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Sole mutator of _files. Canonicalizes + dedupes on the way in so the
   * invariant "_files contains no path that refers to the same physical file
   * as another entry" holds automatically, regardless of which call site
   * constructed the list.
   */
  private _setFiles(files: string[]): void {
    this._files = dedupeFilePaths(files);
  }

  /**
   * Create or show the visualizer for a single file.
   * This will parse all .twf files in the same folder for context,
   * but only show workflows from the focused file at top level.
   */
  public static async createOrShowForFile(extensionUri: vscode.Uri, filePath: string) {
    const folderPath = path.dirname(filePath);

    // Find all .twf files in the folder for context, plus the focused file
    // (which findFiles can legitimately omit if the folder is outside the
    // workspace or shadowed by an exclude). _setFiles handles dedup.
    const pattern = new vscode.RelativePattern(folderPath, "*.twf");
    const uris = await vscode.workspace.findFiles(pattern);
    const files = [...uris.map((u) => u.fsPath), filePath];

    await WorkflowVisualizerPanel.createOrShowForFolder(extensionUri, folderPath, files, filePath);
  }

  /**
   * Create or show the visualizer for a folder with optional focused file.
   */
  public static async createOrShowForFolder(
    extensionUri: vscode.Uri,
    folderPath: string,
    files: string[],
    focusedFile: string | undefined
  ) {
    const column = vscode.ViewColumn.Beside;

    // If we already have a panel, update it (preserveFocus to not steal from editor)
    if (WorkflowVisualizerPanel.currentPanel) {
      WorkflowVisualizerPanel.currentPanel._panel.reveal(column, true);
      WorkflowVisualizerPanel.currentPanel._folderPath = folderPath;
      // Leaving history mode: reusing the panel for .twf files must clear the
      // history file so `_update` takes the parse path.
      WorkflowVisualizerPanel.currentPanel._historyFile = undefined;
      WorkflowVisualizerPanel.currentPanel._setFiles(files);
      WorkflowVisualizerPanel.currentPanel._focusedFile = focusedFile;
      WorkflowVisualizerPanel.currentPanel._update();
      return;
    }

    // Create a new panel (preserveFocus to not steal from editor)
    const panel = WorkflowVisualizerPanel._newWebviewPanel(extensionUri, column);

    WorkflowVisualizerPanel.currentPanel = new WorkflowVisualizerPanel(
      panel,
      extensionUri,
      folderPath,
      files,
      focusedFile
    );
  }

  /**
   * Create or show the visualizer for the sampler's observed-graph JSON. There
   * is no AST, so the panel renders graph-only (history mode) from the file's
   * contents.
   */
  public static async createOrShowForHistory(extensionUri: vscode.Uri, observedFile: string) {
    const column = vscode.ViewColumn.Beside;
    const folderPath = path.dirname(observedFile);

    if (WorkflowVisualizerPanel.currentPanel) {
      const panel = WorkflowVisualizerPanel.currentPanel;
      panel._panel.reveal(column, true);
      panel._folderPath = folderPath;
      panel._historyFile = observedFile;
      panel._setFiles([]);
      panel._focusedFile = undefined;
      panel._update();
      return;
    }

    const panel = WorkflowVisualizerPanel._newWebviewPanel(extensionUri, column);

    WorkflowVisualizerPanel.currentPanel = new WorkflowVisualizerPanel(
      panel,
      extensionUri,
      folderPath,
      [],
      undefined,
      observedFile
    );
  }

  /** Shared webview-panel factory for both .twf and history entry points. */
  private static _newWebviewPanel(
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn
  ): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(
      WorkflowVisualizerPanel.viewType,
      "TWF Visualizer",
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webview"),
        ],
      }
    );
  }

  public static refreshIfVisible() {
    if (WorkflowVisualizerPanel.currentPanel) {
      WorkflowVisualizerPanel.currentPanel._update();
    }
  }

  /**
   * Update the focused file and refresh the visualization.
   * Only updates if the new file is in the same folder or a .twf file.
   *
   * Short-circuits when neither the folder nor the focused file changed.
   * `onDidChangeActiveTextEditor` re-fires every time the .twf editor regains
   * focus — including the focus dance triggered by the webview's "refocus"
   * message after every click. Without this guard each click in the
   * visualizer would trigger a full reparse + AST repost, which in turn
   * resets the GraphView's force simulation to fresh random positions on
   * every interaction (manifests as ~1 Hz "teleport" frames).
   */
  public static async updateFocusedFile(filePath: string) {
    if (!WorkflowVisualizerPanel.currentPanel) {
      return;
    }

    const panel = WorkflowVisualizerPanel.currentPanel;

    // History-mode panels aren't tied to a .twf editor; ignore focus churn so
    // switching editors doesn't tear the sampler graph down into parse mode.
    if (panel._historyFile) {
      return;
    }

    const newFolderPath = path.dirname(filePath);
    const sameFolder = newFolderPath === panel._folderPath;
    const sameFile = filePath === panel._focusedFile;

    if (sameFolder && sameFile) {
      return;
    }

    if (!sameFolder) {
      const pattern = new vscode.RelativePattern(newFolderPath, "*.twf");
      const uris = await vscode.workspace.findFiles(pattern);
      const files = [...uris.map((u) => u.fsPath), filePath];

      panel._folderPath = newFolderPath;
      panel._setFiles(files);
    }

    panel._focusedFile = filePath;
    panel._update();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    folderPath: string,
    files: string[],
    focusedFile: string | undefined,
    historyFile?: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._folderPath = folderPath;
    this._setFiles(files);
    this._focusedFile = focusedFile;
    this._historyFile = historyFile;

    // Set initial HTML content
    this._panel.webview.html = this._getHtmlForWebview();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            this._update();
            break;
          case "refocus":
            // Return focus to the last active text editor after webview interaction
            if (lastActiveTextEditor) {
              vscode.window.showTextDocument(
                lastActiveTextEditor.document,
                { viewColumn: lastActiveTextEditor.viewColumn, preserveFocus: false }
              );
            }
            break;
          case "openFile":
            // Open a file in the editor when the file filter narrows to a single file
            if (message.file) {
              const uri = vscode.Uri.file(message.file);
              vscode.window.showTextDocument(uri, { preserveFocus: false });
            }
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    WorkflowVisualizerPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _update() {
    try {
      // History mode: no .twf files to parse. Read the sampler's observed-graph
      // JSON and project it to the ParserGraph the visualizer renders,
      // synthesizing an empty AST (which the visualizer reads as history mode ->
      // Graph-only). There is no decomposition in history mode (chunks require
      // a .twf AST).
      if (this._historyFile) {
        const parserGraph = await readObservedGraph(this._historyFile);
        const ast = { definitions: [], diagnostics: [] };
        this._panel.webview.postMessage({ type: "ast", data: { ast, parserGraph } });
        return;
      }

      if (this._files.length === 0) {
        throw new Error("No .twf files to visualize");
      }

      // Delegate the CLI subprocessing + payload assembly to the shared module
      // (@temporal-architect/payload) — the same code @temporal-architect/serve
      // runs, so the two subprocess hosts can never drift. This host owns only
      // what is genuinely host-specific: resolving the parser binary and the
      // decomposition settings, and posting to the webview.
      //
      // The overlay is always-on here: VS Code recomputes the chunk
      // decomposition at the configured ceiling on every refresh (there is no
      // UI→toolchain recompute trigger wired on the webview seam), so decompose
      // options are always passed. `buildPayload` returns { ast, parserGraph,
      // decomposition } — graph + chunks best-effort, parse authoritative — the
      // exact shape the webview already consumes.
      const data = await buildPayload({
        twfBin: this._resolveParserBin(),
        files: this._files,
        decompose: this._decomposeOptions(),
        focusedFile: this._focusedFile,
      });
      this._panel.webview.postMessage({ type: "ast", data });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._panel.webview.postMessage({ type: "error", message: errorMessage });
    }
  }

  /**
   * Resolve the `twf` binary used for visualization subprocessing:
   * user config (`twf.parser.path`) > bundled binary > `twf` on PATH.
   *
   * Host-specific and therefore kept here rather than in the shared payload
   * module (which takes an already-resolved binary). The bundled binary path is
   * relative to the extension install; the shared module knows nothing of that.
   */
  private _resolveParserBin(): string {
    const configPath = vscode.workspace
      .getConfiguration("twf.parser")
      .get<string>("path", "");
    if (configPath) return configPath;
    const ext = process.platform === "win32" ? ".exe" : "";
    const bundled = path.join(this._extensionUri.fsPath, "bin", `twf${ext}`);
    return fs.existsSync(bundled) ? bundled : "twf";
  }

  /**
   * Read the decomposition knobs from the `twf.decompose.*` settings into the
   * shared module's DecomposeOptions. Only set fields are forwarded (an unset
   * field takes the tool's own default); the resolved analysis parameters ride
   * back inside the payload, so the webview's read-only Params tab needs nothing
   * more here. A ceiling of 0 disables the overlay — passed through to the tool
   * as-is (0 is a meaningful value, not "unset"), matching prior behavior.
   */
  private _decomposeOptions(): DecomposeOptions {
    const cfg = vscode.workspace.getConfiguration("twf.decompose");
    const opts: DecomposeOptions = { ceiling: cfg.get<number>("ceiling", 60) };
    const floor = cfg.get<number>("floor", 0);
    const maxDepth = cfg.get<number>("maxDepth", 0);
    const strategies = cfg.get<string[]>("strategies", []);
    if (floor > 0) opts.floor = floor;
    if (maxDepth > 0) opts.maxDepth = maxDepth;
    if (strategies.length > 0) opts.by = strategies;
    return opts;
  }

  private _getHtmlForWebview(): string {
    const webview = this._panel.webview;

    // Get URIs for webview resources
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "visualizer.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "visualizer.css")
    );

    // Use a nonce to only allow specific scripts
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>TWF Workflow Visualizer</title>
    <style>
      html, body, #root {
        height: 100%;
        width: 100%;
        margin: 0;
        padding: 0;
        overflow: auto;
      }
    </style>
</head>
<body class="vscode-dark">
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
