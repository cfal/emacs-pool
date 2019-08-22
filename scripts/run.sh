#!/bin/bash

# emacs-pool-daemon's unix domain socket path
sock_path="$HOME/.emacs-pool.sock"

# emacs-pool-daemon's log file path
log_file_path="/dev/null"

# emacs bin directory containing emacs and emacsclient.
emacs_bin_path="$HOME/emacs-build/bin"

if [[ "${OSTYPE}" == "darwin"* ]]; then
    is_running="$(netstat -u | egrep "\\s${sock_path}\$")"
else
    is_running="$(egrep "\\s${sock_path}\$" /proc/net/unix)"
fi

if [ -z "${is_running}" ]; then
    echo "Starting emacs-pool-daemon.."
    rm -f "${sock_path}"
    RUST_LOG=info nohup emacs-pool-daemon \
            --sock "${sock_path}" \
            --emacs "${emacs_bin_path}/emacs" \
        &>"${log_file_path}" &
    sleep 1
fi

exec emacs-pool-client \
     --sock "${sock_path}" \
     --emacsclient "${emacs_bin_path}/emacsclient" \
     "$@"
