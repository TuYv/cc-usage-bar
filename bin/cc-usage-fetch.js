#!/usr/bin/env node
require('../dist/src/fetch.js')
  .main()
  .catch(() => {
    // silent — never pollute the statusline
    process.exit(0);
  });
