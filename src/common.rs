use std::env::home_dir;

pub const DEFAULT_SOCK_FILENAME: &'static str = "emacs-pool-rs.sock";

// Returns $HOME/<DEFAULT_SOCK_FILENAME>
pub fn get_default_sock_path() -> String {
    let mut p = home_dir().expect("Could not read home directory.");
    p.push(DEFAULT_SOCK_FILENAME);
    p.to_str().unwrap().to_string()
}
