# pi-codex-fast

Fast Mode extension for [pi](https://pi.dev) that toggles priority service tier for configured models.

Requires pi 0.74.0 or newer.

## Install

```bash
pi install npm:pi-codex-fast
```

Try it temporarily without installing:

```bash
pi -e npm:pi-codex-fast
```

Or test from a local checkout:

```bash
pi -e ./
```

## Usage

The extension adds the `/fast` command:

```text
/fast          Toggle Fast Mode on/off
/fast on       Enable Fast Mode
/fast off      Disable Fast Mode
/fast toggle   Toggle Fast Mode on/off
/fast status   Show current status
/fast style    Cycle the footer status style
```

When enabled, requests for configured models are patched with `service_tier: "priority"` before they are sent.

## How it works

`pi-codex-fast` reads `~/.pi/agent/extensions/pi-codex-fast.json` and uses that config as the source of truth.

If the current model matches the configured `models` list and `enabled` is `true`, the extension uses Pi's `before_provider_request` hook to patch the outgoing provider payload with:

```json
{
  "service_tier": "priority"
}
```

This means model matching is driven by the config file, not by a hard-coded provider whitelist.

## Configuration

On first load, the extension creates:

```text
~/.pi/agent/extensions/pi-codex-fast.json
```

If `PI_CODING_AGENT_DIR` is set, the config is created under that agent directory instead.

Default config:

```json
{
  "enabled": false,
  "models": ["openai/gpt-5.4", "openai/gpt-5.5"]
}
```

Optional fields such as `style` are resolved internally and only written when changed via `/fast style`.

Model entries may be provider-qualified, for example `cc-switch/gpt-5.4`, or bare model IDs, for example `gpt-5.4`.

Examples:

```json
{
  "enabled": true,
  "models": [
    "cc-switch/gpt-5.4",
    "cc-switch/gpt-5.5",
    "gpt-5.3-codex"
  ]
}
```

## License

MIT
