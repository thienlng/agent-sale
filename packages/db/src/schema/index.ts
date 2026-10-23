// One schema file per backend module. Global (non-tenant) tables live in identity.ts and platform.ts.
export * from './identity.js';
export * from './workspace.js';
export * from './platform.js';
export * from './bot.js';
export * from './knowledge.js';
