# emacs-pool

emacs-pool is an emacs daemon pool that preloads single-use emacs daemons in the background. It aims to provide an equivalent experience to non-daemon mode emacs but with a faster startup.

emacs-pool consists of two binaries:

- `emacs-pool-daemon`: Pre-loads emacs daemons in the background. Automatically starts up new daemons, and kills daemons after use. Listens for client connections via unix domain socket.

- `emacs-pool-client`: Asks `emacs-pool-daemon` for a new emacs daemon, and then runs `emacsclient` to connect to it. The emacs daemon will be destroyed after `emacsclient` is closed.

## Installation

Releases for certain architectures are available on GitHub, else you can build and install it yourself.

## Building

Requirements:
- Rust and Cargo installation
- emacs 26.1 or newer (for --fg-daemon flag)

`cargo install emacs-pool` will build and install `emacs-pool-daemon` and `emacs-pool-client` to your cargo bin directory.

## Usage

Link or copy `scripts/run.sh` to somewhere on your path and use it instead of emacs. The script will automatically start up `emacs-pool-daemon` in the background if necessary before invoking `emacs-pool-client`. Edit the script variables at the top to configure socket path and emacs paths.

## Notes

- The daemon can be shutdown with `killall emacs-pool-daemon` when startup with `run.sh`. Using SIGKILL (-9) would not give the server time to shutdown the emacs daemons, and you would have to do so manually.
