# @temporal-architect/twf

{{fragment:global}}

This is the npm distribution of the `twf` binary — a thin Node shim around platform-specific binaries published as `@temporal-architect/twf-<platform>` optional dependencies. npm installs only the binary for the current OS/arch.

## Install

```bash
npm install -g @temporal-architect/twf
twf --help
```

Or zero-install via `npx`:

```bash
npx -y @temporal-architect/twf check workflows.twf
```

{{fragment:parser}}

{{fragment:mcp}}

## Supported platforms

| Platform | Package |
|---|---|
| macOS arm64 (Apple Silicon) | `@temporal-architect/twf-darwin-arm64` |
| macOS x64 (Intel)           | `@temporal-architect/twf-darwin-x64` |
| Linux x64                   | `@temporal-architect/twf-linux-x64` |
| Linux arm64                 | `@temporal-architect/twf-linux-arm64` |
| Windows x64                 | `@temporal-architect/twf-win32-x64` |

**`<pkg> not installed`** — npm skipped the optional dependency. Reinstall with `npm install --include=optional @temporal-architect/twf`.

## Versioning

Versions track the upstream `temporal-architect` Git tag, so `0.3.x` of this package corresponds to `v0.3.x` of the toolchain.

## License

MIT. See [LICENSE](https://github.com/jmbarzee/temporal-architect/blob/main/LICENSE).
