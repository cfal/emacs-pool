# emacs-pool

emacs-pool is an emacs daemon pool to speed up emacs startup time, without having shared buffers across multiple emacs clients.

emacs-pool consists of two components:

- `server.js`: Pre-loads emacs daemons in the background. Automatically starts up new daemons, and kills excess daemons depending on usage. Listens for client connections via unix domain socket.

- `client.js`: Asks the server for a shiny new emacs daemon, and then runs `emacsclient` for you.

By default, the server will destroy used daemons after the client disconnects and start a new one. See `opts.js` for now to change this behavior.

## Requirements

- nodejs build with async/await support
- emacs 26.x (for --fg-daemon flag)

## Usage

Create a shell script in your `bin` directory with the following contents, and use it instead of `emacs` or `emacsclient`:

```
#!/bin/sh

exec node emacs-pool/src/client.js \
  [--sock <emacs-pool socket path>] \
  [--min-pool-size <size>] \
  [--emacs-path <path to emacs binary>] \
  [--emacs-client-path <path to emacs client binary>]
  $@
```

- `sock`: Unix domain socket for the pool server. Defaults to `$HOME/.emacs-pool.sock`.

- `min-pool-size`: Minimum daemon pool size. Defaults to 4.

- `emacs-path`: Full path to the `emacs` binary. Defaults to `emacs`.

- `emacs-client-path`: Full path to the `emacsclient` binary. Defaults to `emacsclient`.

## Notes

- `client.js` will automatically start up the server in the background. Alternatively, you can explicitly start up `server.js`, which supports the same command-line arguments.

- More flags are available in `opt.js`.

