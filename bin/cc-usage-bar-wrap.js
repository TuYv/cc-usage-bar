#!/usr/bin/env node
require('../dist/src/wrap.js')
  .main()
  .catch(() => {
    // silent — never pollute the statusline
    process.exit(0);
  });
