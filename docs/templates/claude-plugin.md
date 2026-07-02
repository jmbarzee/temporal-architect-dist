# @temporal-architect/claude-plugin

The skills payload for the [temporal-architect Claude Code plugin](https://github.com/jmbarzee/temporal-architect).

You almost certainly don't want to install this directly. It's the npm-side delivery vehicle Claude Code's marketplace mechanism pulls from when a user installs the `temporal-architect` plugin.

## Install (the user-facing way)

```text
/plugin marketplace add jmbarzee/temporal-architect-dist
/plugin install temporal-architect@temporal-architect
```

{{fragment:global}}

## Skills

Bundled and available to Claude as auto-discoverable agent skills:

{{skills}}

{{fragment:mcp}}

## Source of truth

The skills shipped here are a build-time copy of the canonical [`skills/`](https://github.com/jmbarzee/temporal-architect/tree/main/skills) in the toolchain repo, and this README is composed from the toolchain's doc fragments — edit there, not here. The staged copy is gitignored; it only exists after a local build or during npm publish.

## License

MIT — see the bundled `LICENSE`.
