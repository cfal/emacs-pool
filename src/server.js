'use strict';

const fs = require('fs'),
      util = require('util'),
      path = require('path'),
      net = require('net'),
      Pool = require('./pool'),
      opts = require('./opts')(true);

const exists = util.promisify(fs.exists);

(async function() {
  process.title = 'emacs-pool';

  if (await exists(opts.sockPath)) {
    throw new Error('Server socket path already exists.');
  }

  const pool = new Pool(opts);
  await pool.init();

  const connections = [];
  let closed = false;

  const server = net.createServer(async (conn) => {
    if (closed) {
      console.error('Got connection after closing.');
      try {
        conn.on('error', function(err) {});
        conn.end();
        conn.destroy();
      } catch (err) {
      }
      return;
    }

    console.log('Got new connection.');
    connections.push(conn);
    const daemonName = await pool.take();
    conn.on('end', function() {
      const i = connections.indexOf(conn);
      if (i < 0) {
        console.error("Could not find active connection!");
        return;
      }
      connections.splice(i, 1);
      pool.give(daemonName);
    });
    conn.on('error', function(err) {
      console.error('Unhandled connection error: ' + err);
    });
    conn.write(daemonName);
    conn.write('\n');
  });

  const closeServer = () => {
    return new Promise(resolve => {
      if (server.listening) {
        server.close(resolve);
      } else {
        resolve();
      }
    });
  };

  const shutdown = async (exitCode) => {
    if (closed) return;
    closed = true;

    console.log('Shutting down.');

    setTimeout(() => {
      console.log('Shutdown timed out, force exiting.');
      process.exit(exitCode || 1);
    }, 10000);

    connections.forEach(conn => {
      conn.removeAllListeners('end');
      conn.removeAllListeners('error');
      conn.on('error', function(){});
      try {
        conn.end();
        conn.destroy();
      } catch (err) {
      }
    });

    await closeServer();
    console.log('Server closed.');

    await pool.destroy();
    console.log('Shutdown complete.');

    process.exit(exitCode);
  };

  process.on('exit', code => {
    shutdown(code || 0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM.');
    shutdown(0);
  });

  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT.');
    shutdown(1);
  });

  server.listen(opts.sockPath, async () => {
    console.log('Pool is ready.');
  });
})();
