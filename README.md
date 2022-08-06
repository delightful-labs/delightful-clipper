## Introduction

This is a project to create a web clipper that stores web clippings on IPFS via WnFS and allows you to read them later. It currently supports clipping web pages and PDFs and allows uploading of ePub files. It is a work in progress and is constantly being updated to the main branch, so things might break if used.

It uses Svelte as the frontend library and XState to control state.

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
