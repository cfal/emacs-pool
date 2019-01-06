# emacs-pool

emacs-pool is an emacs daemon pool to speed up emacs startup without having to think about daemon mode.

emacs-pool consists of two components:

- `server.js`: Pre-loads emacs daemons in the background. Automatically starts up new daemons, and kills excess daemons depending on usage. Listens for client connections via unix domain socket.

- `client.js`: Asks the server for a shiny new emacs daemon, and then runs `emacsclient` for you.

By default, the server will destroy used daemons after the client disconnects and start a new one. See the `--no-single-use` flag to change this behavior.

## Requirements

- nodejs build with async/await support
- emacs 26.1 (for --fg-daemon flag)

## Usage

Create a shell script in your `bin` directory with the following contents, and use it instead of `emacs` or `emacsclient`:

```sh
#!/bin/sh

# Start the client script. The current directory (.) is appended to the arguments that will be
# passed to emacsclient so that emacsclient will not automatically close if all of the initially
# specified buffers are closed.
exec node emacs-pool/src/client.js \
  [--sock <emacs-pool socket path>] \
  [--min-pool-size <size>] \
  [--min-available <count>] \
  [--no-single-use] \
  [--emacs-path <path to emacs binary>] \
  [--emacs-client-path <path to emacsclient binary>]
  "$@" \
  .
```

- `sock`: Unix domain socket for the pool server. Defaults to `$HOME/.emacs-pool.sock`.

- `min-pool-size`: Minimum daemon pool size. Defaults to 4.

- `min-available`: Minimum available count. Extra daemons will be created if the number of available daemons drops below this number. Defaults to 4.

- `no-single-use`: Disables single use mode, ie. daemons will stay alive and be re-used. Note that this means open unsaved files and other state will be visible during following client sessions.

- `emacs-path`: Full path to the `emacs` binary. Defaults to `emacs`.

- `emacs-client-path`: Full path to the `emacsclient` binary. Defaults to `emacsclient`.

## Notes

- `client.js` will automatically start up the server in the background. Alternatively, you can explicitly run `server.js`, which supports the same command line arguments.

- To restart the emacs pool server, use `killall emacs-pool`, which defaults to using SIGTERM. Using SIGKILL (-9) would not give the server time to shutdown the emacs daemons, and you would have to do so manually.

- More flags are available in `opts.js`.
