// Vercel serverless function adapter — re-exports the pre-bundled Express
// app (built by artifacts/api-server/build.mjs) as the request handler.
// Vercel's Node.js runtime accepts an Express app's request-handler function
// as a module's default export directly.
//
// Deliberately re-exporting a pre-bundled dist/app.mjs (rather than importing
// artifacts/api-server/src/app.ts source directly) so pino's worker-thread
// log transports get bundled by the same esbuild config/plugins that already
// handles them correctly, instead of Vercel's generic function bundler
// tracing that dependency graph itself.
export { default } from "../artifacts/api-server/dist/app.mjs";
