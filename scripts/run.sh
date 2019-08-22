#!/bin/bash

sock_path="$HOME/.epc.sock"
log_path="$HOME/.emacs-pool-rs.log"
emacs_bin_path="$HOME/emacs-build/bin"

if [[ "${OSTYPE}" == "darwin"* ]]; then
    is_running="$(netstat -u | egrep "\\s${sock_path}\$")"
else
    is_running="$(egrep "\\s${sock_path}\$" /proc/net/unix)"
fi

if [ -z "${is_running}" ]; then
    echo "Starting daemon."
    rm -f "${sock_path}"
    RUST_LOG=info nohup emacs-pool-daemon --sock "${sock_path}" --emacs "${emacs_bin_path}/emacs" &>"${log_path}" &
    sleep 0.5
fi

exec emacs-pool-client --sock "${sock_path}" --emacsclient "${emacs_bin_path}/emacsclient" $@
