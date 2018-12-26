'use strict';

const path = require('path');

const DEFAULT_OPTS = {
  debug: false,
  sockPath: path.resolve(process.env.HOME, '.emacs-pool.sock'),
  emacsClientPath: 'emacsclient',
  emacsPath: 'emacs',
  minPoolSize: 4,
  minAvailableCount: 4,
  // when singleUse this is true, the daemon is killed and a new daemon is restarted after each use.
  singleUse: true,
  // unparsed arguments will be passed to emacs.
  emacsArgs: [],
};

module.exports = function(isServer) {
  const opts = Object.assign({}, DEFAULT_OPTS);

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg == '--debug') {
      opts.debug = true;
    } else if (arg == '--sock') {
      const sockPath = args[++i];
      if (!sockPath) return null;
      opts.sockPath = sockPath;
    } else if (arg == '--emacs-client-path') {
      const emacsClientPath = args[++i];
      if (!emacsClientPath) throw new Error('No emacs client path provided.');
      opts.emacsClientPath = emacsClientPath;
    } else if (arg == '--emacs-path') {
      const emacsPath = args[++i];
      if (!emacsPath) throw new Error('No emacs path provided.');
      opts.emacsPath = emacsPath;
    } else if (arg == '--min-pool-size') {
      const minPoolSize = args[++i];
      if (!minPoolSize || minPoolSize < 1) throw new Error('No minimum pool size provided.');
      opts.minPoolSize = minPoolSize;
    } else if (arg == '--min-available') {
      const minAvailableCount = args[++i];
      if (!minAvailableCount || minAvailableCount < 1)
        throw new Error('No minimum available count provided.');
      opts.minAvailableCount = minAvailableCount;
    } else if (arg == '--no-single-use') {
      opts.singleUse = false;
    } else {
      opts.emacsArgs.push(arg);
    }
  }

  if (opts.minAvailableCount > opts.minPoolSize) {
    throw new Error('Minimum pool size must be at least minimum available count.');
  }

  return opts;
};
