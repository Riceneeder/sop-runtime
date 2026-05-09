# HTTP Workflow Example

This workflow demonstrates an HTTP executor step whose URL is dynamically
resolved from run input via the adapter's `resolveConfigTemplates` option.

## Requirement

The HTTP adapter reads `executor.config` directly — core's `buildStepPacket`
resolves templates in `step.inputs` but leaves executor config opaque.
To use expression templates in `config.url` (like `${run.input.api_url}`),
the host **must** set `resolveConfigTemplates: true` when creating the adapter:

```ts
const adapter = createHttpExecutor({
  allowNetwork: true,
  allowedOrigins: ['https://api.example.com'],
  resolveConfigTemplates: true, // resolves ${...} in config
});
```

When `resolveConfigTemplates` is `false` (the implicit default), the raw
template string is sent as the URL, which will fail.

## Usage

```sh
bun run cli -- validate examples/http_workflow/sop.json
bun run cli -- trace examples/http_workflow/sop.json --input examples/http_workflow/input.example.json
```
