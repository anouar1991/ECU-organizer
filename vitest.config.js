/**
 * Vitest configuration for ECU File Skinner Pro.
 *
 * Tests live in `tests/` and run under plain Node (NOT Electron). Modules that
 * require `better-sqlite3` (database.js, dtc-lookup.js) are ABI-locked to the
 * Electron runtime via the `postinstall` electron-rebuild step — those tests
 * detect the load failure and skip cleanly rather than crashing the suite.
 */
module.exports = {
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    pool: 'forks',
    reporters: ['default']
  }
};
