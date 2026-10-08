# Developer documentation

Start with the [plugin README](../../README.md) for features, requirements, installation, and everyday use. This directory is for maintainers and contributors.

## Development setup

Use Node.js 22.13+ in the 22 series, or 24, and Homebridge 2. Install dependencies before running checks:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
npm pack --dry-run --ignore-scripts
```

Read [working agreements](../../AGENTS.md) before changing runtime behavior. CI also checks real Homebridge processes with synthetic hardware and desktop/mobile browser flows. Automated checks are separate from supervised testing on physical hardware.

## Implementation and maintenance

- [Implementation plan](../implementation-plan.md), [behavior parity](../behavior-parity.md), and [migration plan](../migration.md).
- [Management API contract](../api-v1.md).
- [Developer status and validation history](../status.md).
- [Release and npm publication workflow](../npm-release.md).
- [Web admin implementation status](../web-admin-node-status.md).
- [Earlier README and owner-test development notes](readme-history.md).
- [Earlier release instructions and validation receipts](npm-release-history.md).

Historical documents preserve the context of earlier work. Their version numbers, pending-release statements, and installation commands are not current instructions.
