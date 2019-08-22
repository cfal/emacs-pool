use std::env;
use std::path::PathBuf;

pub fn default_sock_filename() -> &'static str {
    ".emacs-pool.sock"
}

pub fn default_sock_path() -> String {
    let mut buf = PathBuf::from(env::var_os("HOME").expect("Could not read $HOME"));
    buf.push(default_sock_filename());
    buf.to_str()
        .expect("Could not get default sock path")
        .to_string()
}
