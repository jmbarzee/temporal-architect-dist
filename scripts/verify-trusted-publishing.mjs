// Exchanges this GitHub Actions job's OIDC token for a short-lived publishing
// token from one extension registry, through the same CLI code that
// `vsce publish --oidc` / `ovsx publish --trusted-publishing` run, then stops.
// Success proves the registry's trusted-publisher registration matches this
// workflow; nothing is published and the issued token is never printed.
//
// Usage: node scripts/verify-trusted-publishing.mjs <vscode|ovsx> <cli-install-dir>
// (run via `make verify-trusted-publishing REGISTRY=…`, which installs the CLIs).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [registry, cliDir] = process.argv.slice(2);
const require = createRequire(join(cliDir, "node_modules", ".require"));
const { publisher, name } = JSON.parse(readFileSync("packages/vscode/package.json", "utf8"));

const exchanges = {
  vscode: () => require("@vscode/vsce/out/oidc.js").getOIDCCredential(publisher),
  ovsx: () => {
    const { Registry, getTrustedPublishingToken } = require("ovsx");
    return getTrustedPublishingToken(new Registry(), publisher, name, { trustedPublishing: true });
  },
};

if (!exchanges[registry]) {
  console.error(`usage: verify-trusted-publishing.mjs <${Object.keys(exchanges).join("|")}> <cli-install-dir>`);
  process.exit(2);
}

try {
  const token = await exchanges[registry]();
  if (!token) throw new Error("the registry returned an empty token");
  console.log(`${registry}: trusted publishing OK for ${publisher}.${name} (token issued, not used)`);
} catch (err) {
  console.error(`::error::${registry}: trusted publishing exchange failed for ${publisher}.${name}: ${err.message}`);
  process.exit(1);
}
