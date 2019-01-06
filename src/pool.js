'use strict';

const child_process = require('child_process'),
      util = require('util');

const execFile = util.promisify(child_process.execFile);

class Pool {
  constructor({ minPoolSize, minAvailableCount, emacsPath, emacsClientPath, singleUse }) {
    this.minPoolSize = minPoolSize;
    this.minAvailableCount = minAvailableCount;
    this.emacsPath = emacsPath;
    this.emacsClientPath = emacsClientPath;
    this.singleUse = singleUse;
    this.destroyed = false;
    this.daemons = {};
    this.daemonCounter = 0;

    this.increasing = false;
    this.increaseTimeoutId = 0;

    this.culling = false;
    this.cullTimeoutId = 0;
  }

  _createName() {
    while (true) {
      let name = Math.random().toString(36);
      const i = name.indexOf('.');
      if (i < 0) continue;
      name = name.slice(i + 1).replace(/[0-9]/g, '');
      if (name.length < 3) continue;
      name = name.slice(0, 3);
      if (!(name in this.daemons)) {
        return name;
      }
    }
  }

  _getAvailable() {
    const availableDaemons = [];
    for (const name in this.daemons) {
      const daemon = this.daemons[name];
      if (daemon.available) {
        availableDaemons.push(daemon);

      }
    }
    return availableDaemons;
  }

  _add(available = true) {
    return new Promise(resolve => {
      const name = this._createName();

      const p = str => console.log(`[${name}] ${str}`);
      p('Creating new process.');
      const spawnOpts = {
        stdio: [
          'ignore', // stdin
          'pipe', // stdout
          'pipe' // stderr
        ],
        // without detached, pressing ctrl-c on the server process seems to
        // cause SIGINT to randomly be sent to some child processes which messes
        // up the quit logic.
        detached: true
      };

      const proc = child_process.spawn(
        this.emacsPath,
        [ `--fg-daemon=${name}` ],
        spawnOpts);

      proc.on('error', err => {
        p(`Process error: ${err}`);
      });
      proc.on('exit', (code, signal) => {
        p(`Process exit (code ${code}, signal ${signal})`);
        if (!(this.daemons[name])) {
          p(`ERROR: Exiting daemon was already removed.`);
          return;
        }
        delete this.daemons[name];
      });

      let buffer = '';
      const processData = data => {
        buffer += data;

        if (buffer.indexOf('Starting Emacs daemon.') < 0) return;

        proc.stdout.removeAllListeners('data');
        proc.stderr.removeAllListeners('data');

        proc.stdout.on('data', data => {
          p(data.toString().trimRight());
        });
        proc.stderr.on('data', data => {
          p(data.toString().trimRight());
        });

        // Even after the "Starting Emacs daemon" message, the socket file
        // still takes a little time to create.
        setTimeout(() => {
          this.daemons[name] = {
            name,
            proc,
            available
          };
          p(`Daemon ready, pid ${proc.pid}.`);
          resolve(name);
        }, 250);
      };

      proc.stdout.on('data', processData);
      proc.stderr.on('data', processData);
    });
  }

  async _kill(daemonName, proc) {
    try {
      await execFile(this.emacsClientPath, ['-s', daemonName, '-e', '(kill-emacs)']);
    } catch (err) {
      console.warn(`Error killing daemon ${daemonName}: ${err}`);
      return false;
    }
    // TODO: check if this is actually necessary for processes to close on some OSes.
    proc.stdout.destroy();
    proc.stderr.destroy();

    // It's still possible that there's a locked file and (kill-emacs) didn't cause emacs to stop.
    setTimeout(() => {
      try {
        // TODO: check if SIGTERM is guaranteed to kill it here, maybe SIGKILL is necessary.
        proc.kill('SIGTERM');
      } catch (err) {
      }
    }, 2000);
    return true;
  }

  _remove(daemonName, wait = false) {
    return new Promise(async (resolve) => {
      const daemon = this.daemons[daemonName];
      if (!daemon) {
        console.error(`Daemon ${daemonName} targetted for removal doesn't exist.`);
        resolve(false);
        return;
      }
      const { proc, available } = daemon;
      if (!available) {
        console.warn(`Removing un-available daemon ${daemonName}.`);
      }
      if (wait) {
        console.log(`Sending kill signal to daemon ${daemonName} and waiting.`);
        delete this.daemons[daemonName];
        proc.removeAllListeners('exit');
        proc.on('exit', (code, signal) => {
          console.log(`Daemon ${daemonName} process ended as expected, removal complete.`);
          resolve(true);
        });
        await this._kill(daemonName, proc);
      } else {
        // When wait is false, let the proc 'close' event handle removal.
        console.log(`Sending kill signal to daemon ${daemonName}.`);
        // Set daemon available to false so that it isn't given out while awaiting the kill.
        daemon.available = false;
        await this._kill(daemonName, proc);
        resolve(true);
      }
    });
  }

  async _increase() {
    if (this.destroyed || this.increasing) return;

    this.increasing = true;
    console.log(`Increasing pool size.`);

    let added = 0;
    while (!this.destroyed && this._getAvailable().length < this.minAvailableCount) {
      await this._add();
      added++;
    }

    console.log(`Increase pool size complete, created ${added} daemons.`);
    this.increasing = false;
  }

  _scheduleIncrease() {
    if (this.increaseTimeoutId) {
      clearTimeout(this.increaseTimeoutId);
    }
    this.increaseTimeoutId = setTimeout(() => {
      this.increaseTimeoutId = 0;
      this._increase();
    }, 500);
  }

  async _cull() {
    if (this.destroyed || this.culling) return;

    this.culling = true;
    // Put this in a loop to continuously recalculate available daemons and cull.
    // This is because we await this._remove in the loop and availability could
    // change during that time.
    console.log(`Starting to remove extra daemons.`);
    let removed = 0;
    while (!this.destroyed) {
      const availableDaemons = this._getAvailable();
      if (availableDaemons.length > this.minAvailableCount) {
        const totalDaemonCount = Object.keys(this.daemons).length;
        if (totalDaemonCount > this.minPoolSize) {
          const removable = availableDaemons.length - this.minAvailableCount;
          if (removable > 0) {
            const daemon = availableDaemons.pop();
            await this._remove(daemon.name);
            removed++;
            continue;
          }
        }
      }
      break;
    }
    console.log(`Remove extra daemons complete, removed ${removed} daemons.`);
    this.culling = false;
  }

  _scheduleCull() {
    if (this.cullTimeoutId) {
      clearTimeout(this.cullTimeoutId);
    }
    this.cullTimeoutId = setTimeout(() => {
      this.cullTimeoutId = 0;
      this._cull();
    }, 2000);
  }

  async init() {
    for (let i = 0; i < this.minPoolSize; i++) {
      await this._add();
    }
  }

  async destroy() {
    if (this.destroyed) return;

    // It's necessary to destroy the daemons sequentially, as some files might be written to
    // upon shutdown. One emacs daemon would lock the file, and others would then cause a
    // prompt to show up in the daemon process:
    // "filename locked by username... (pid xx): (s, q, p, ?)?"
    // which causes those daemons not to die from a SIGTERM.
    console.log('Destroying pool.');
    const daemons = Object.keys(this.daemons);
    for (let i = 0; i < daemons.length; i++) {
      await this._remove(daemons[i], true);
    }
    console.log('Pool has been destroyed.');
  }

  async take() {
    if (this.destroyed) return null;

    const availableDaemons = this._getAvailable();
    if (availableDaemons.length == 0) {
      // No available daemons, create a new one and return it.
      console.log('No available daemon, creating new one immediately!');
      const newName = await this._add(false);
      console.log(`Set new daemon unavailable: ${newName}`);
      return newName;
    }

    const daemon = availableDaemons.shift();
    daemon.available = false;
    console.log(`Set daemon unavailable: ${daemon.name}`);

    if (availableDaemons.length < this.minAvailableCount) {
      this._scheduleIncrease();
    }

    return daemon.name;
  }

  async give(daemonName) {
    if (this.destroyed) return false;

    const daemon = this.daemons[daemonName];
    if (!daemon) {
      console.error(`Returned daemon doesn't exist: ${daemonName}`);
      return false;
    }
    if (daemon.available) {
      console.error(`Returned daemon is already available: ${daemonName}`);
      return false;
    }

    if (this.singleUse) {
      console.log(`Single-use enabled, removing daemon.`);
      await this._remove(daemonName);
      const availableCount = this._getAvailable().length;
      if (availableCount >= this.minAvailableCount) {
        console.log(`Not creating new daemon after single-use daemon removal, enough availability (${availableCount}).`);
      } else {
        console.log(`Creating new daemon to replace used daemon.`);
        await this._add();
      }
    } else {
      console.log(`Set daemon available: ${daemonName}`);
      daemon.available = true;
    }

    if (this._getAvailable().length > this.minAvailableCount) {
      this._scheduleCull();
    }

    return true;
  }
}

module.exports = Pool;
