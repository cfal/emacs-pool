mod common;
use crate::common::*;

use clap::{App, Arg};
use futures::StreamExt;
use log::debug;
use tokio::net::UnixStream;
use tokio_util::codec::{FramedRead, LinesCodec};

use std::process::{Command, Stdio};

async fn run_client(sock_path: &str, emacsclient_path: &str, files: Vec<String>) {
    let stream = UnixStream::connect(sock_path).await.unwrap();

    let mut reader = FramedRead::new(stream, LinesCodec::new());

    let daemon_name: String = reader
        .next()
        .await
        .expect("Failed to read from socket")
        .unwrap();

    debug!("Received daemon: {}", daemon_name);

    let mut command = Command::new(emacsclient_path);

    command.arg("-s").arg(daemon_name);

    command.arg("--");

    for file in files {
        command.arg(&file);
    }

    // Add the current directory as an argument to prevent it from closing when provided
    // files are closed.
    // Also required in case no filenames were provided.
    command.arg(".");

    command.stdin(Stdio::inherit()).stdout(Stdio::inherit());

    let output = command.output().expect("Failed to run emacsclient");

    debug!("Client exited with status: {}", output.status);
    debug!("stdout: {}", std::str::from_utf8(&output.stdout).unwrap());
    debug!("stderr: {}", std::str::from_utf8(&output.stderr).unwrap());
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

    let args = App::new("emacs-pool-client")
        .arg(
            Arg::new("sock")
                .short('s')
                .long("sock")
                .value_name("PATH")
                .help(
                    format!(
                        "Sets the socket path (Default: $HOME/{})",
                        default_sock_filename()
                    )
                    .as_str(),
                )
                .takes_value(true),
        )
        .arg(
            Arg::new("emacs-client-path")
                .short('c')
                .long("emacsclient")
                .value_name("FILE")
                .help("Sets emacsclient binary location")
                .takes_value(true),
        )
        .arg(Arg::with_name("file").multiple(true))
        .get_matches();

    let sock_path = args
        .value_of("sock")
        .map(|val| val.to_string())
        .unwrap_or_else(default_sock_path);

    let emacsclient_path = args.value_of("emacs-client-path").unwrap_or("emacsclient");

    let files: Vec<String> = match args.values_of("file") {
        Some(vals) => vals.map(|s| s.to_string()).collect(),
        None => vec![],
    };

    run_client(&sock_path, emacsclient_path, files).await;

    Ok(())
}
