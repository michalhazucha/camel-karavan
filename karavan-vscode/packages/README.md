# Karavan mapper packages

## `@karavan/mapper-core`

Pure TypeScript: XSD/XSLT parsing and XSLT generation. Shared by the mapper UI and Karavan designer host bridge.

## `@karavan/mapper-ui`

React 19 + shadcn + Tailwind mapper UI (from the standalone Maper project). Builds an IIFE bundle:

- `dist/mapper/karavan-mapper.js`
- `dist/mapper/karavan-mapper.css`

Loaded by `KaravanMapperMount` in the designer Mapper tab.

## Build

From `karavan-vscode`:

```bash
npm run build:mapper    # core + ui
npm run compile         # includes build:mapper, then webpack
```

## Local UI dev (browser)

```bash
cd packages/mapper-ui
npm run dev
```

## Standalone Maper repo

Continue UX experiments in `~/www/Maper`; port changes back into `packages/mapper-ui` and `packages/mapper-core`.
