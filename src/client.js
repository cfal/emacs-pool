'use strict';

const fs = require('fs'),
      path = require('path'),
      net = require('net'),
      child_process = require('child_process'),
      opts = require('./opts')(false);

function debug(str) {
  if (!opts.debug) return;
  console.log(str);
}

function run() {
  const sock = net.connect(opts.sockPath, () => {
    debug('Connected to pool socket.');
  });
  sock.on('end', function() {
    // TODO: kill the emacsclient process
    console.error("Pool socket exit.");
    process.exit(0);
  });
  sock.on('error', function(err) {
    // TODO: kill the emacsclient process
    console.error(`Pool socket error: ${err}`);
  });

  let buf = '';
  sock.on('data', function(data) {
    buf += data;
    const i = buf.indexOf('\n');
    if (i < 0) return;

    sock.removeAllListeners('data');
    const daemonName = buf.slice(0, i);
    debug(`Received daemon: ${daemonName}`);

    const emacsArgs = opts.emacsArgs;
    if (!emacsArgs.length) {
      // emacsclient will not start without at least 1 argument.
      emacsArgs.push('.');
    }

    const proc = child_process.spawn(
      opts.emacsClientPath,
      [`--socket-name=${daemonName}`].concat(emacsArgs),
      {
        stdio: 'inherit'
      });

    proc.on('exit', () => {
      debug('Emacs client closed, exiting.');
      try {
        sock.removeAllListeners('end');
        sock.on('end', function(){});
        sock.end();
      } catch (err) {
      }
      process.exit(0);
    });
  });
}

(function() {
  // Start the server if necessary.
  if (!fs.existsSync(opts.sockPath)) {
    console.log("Server socket not found, starting in background, please wait..");
    const serverProc = child_process.spawn(
      process.argv[0],
      [ path.resolve(__dirname, 'server.js') ].concat(process.argv.slice(2)),
      {
        detached: true,
        stdio: [
          'ignore', // stdin
          'pipe', // stdout
          'pipe' // stderr
        ]
      });

    let buffer = ''
    function handleData(data) {
      debug(`[Server] ${data.toString().trimRight()}`);
      buffer += data;
      if (buffer.indexOf('Pool is ready.') < 0) return;
      // At least one daemon is ready, let's startup.
      debug('Pool server is ready, connecting.');
      serverProc.stdout.removeAllListeners('data');
      serverProc.stderr.removeAllListeners('data');
      serverProc.stdout.destroy();
      serverProc.stderr.destroy();
      serverProc.unref();

      // TODO: If the minimum pool size is small, it's possible that
      // the socket files are not ready even after the daemons have been
      // added and set to available. Consider checking pool size and
      // adding an appropriate delay before calling run().
      run();
    }

    serverProc.stdout.on('data', handleData);
    serverProc.stderr.on('data', handleData);
    return;
  }

  run();
})();
