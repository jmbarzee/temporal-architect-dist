# twf-cli

{{fragment:global}}

`twf-cli` is a thin wrapper around the bundled platform binary — same tool, same flags, same output as the standalone `twf` distribution, installable via `pip`.

## Install

```bash
pip install twf-cli
twf --help
```

The wheel for your platform ships the matching `twf` binary. Supported platforms (one wheel each): `macosx_11_0_arm64`, `macosx_10_15_x86_64`, `manylinux2014_x86_64`, `manylinux2014_aarch64`, `win_amd64`.

{{fragment:parser}}

{{fragment:mcp}}

## Subprocess use from Python

```python
import subprocess, json

result = subprocess.run(
    ["twf", "parse", "workflow.twf"],
    capture_output=True, text=True, check=True,
)
ast = json.loads(result.stdout)
```

## Versioning

Versions track the upstream `temporal-architect` Git tag, so `0.3.x` of this package corresponds to `v0.3.x` of the toolchain.

## License

MIT. See [LICENSE](https://github.com/jmbarzee/temporal-architect/blob/main/LICENSE).
