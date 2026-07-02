# test-instructions

Plain-English test instructions for the Genie CLI. Drop a `.txt` (or `.md`) file
here when a flow is long or has several steps — easier than a giant one-line
string on the command line.

## Usage

Pass a **bare name** and the CLI looks it up in this folder (the `.txt`/`.md`
extension is optional):

```bash
npm run generate -- --file login-flow          # → tests/generated-<ts>.spec.ts
npm run generate -- --file login-flow tests/login.spec.ts
npm run achieve  -- --file smoke-checkout --headed
```

Pass an **explicit path** (absolute, or containing a `/`, or starting with `.`)
and it's read directly from the filesystem, wherever it lives:

```bash
npm run generate -- --file ./drafts/new-flow.txt
npm run achieve  -- -f /tmp/exploratory.txt
```

Inline text still works exactly as before:

```bash
npm run generate -- "log in and verify the dashboard loads"
```

## Notes

- If the file (or the folder lookup) doesn't resolve, the CLI logs a clear error
  and exits — no stack trace, no API key required.
- Write instructions as ordered steps ending with an explicit **"Verify…"** line;
  see `example-search.txt`.
