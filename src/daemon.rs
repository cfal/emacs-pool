#[macro_use]
extern crate log;

extern crate env_logger;

extern crate rand;

extern crate clap;

mod common;
use crate::common::*;

use clap::{App, Arg};

use futures::{future, select};

use rand::Rng;

use std::fs;
use std::process::Stdio;
use std::time::Duration;

use tokio::codec::{FramedRead, LinesCodec};
use tokio::net::{UnixListener, UnixStream};
use tokio::prelude::*;

use tokio_net::process::{Child, ChildStderr, Command};
use tokio_net::signal::unix::{signal, SignalKind};

use tokio_timer::sleep;

const DEFAULT_POOL_SIZE: usize = 5;

struct Daemon {
    name: String,
    process: Option<Child>,
    stderr_reader: FramedRead<ChildStderr, LinesCodec>,
}

impl Daemon {
    pub fn new(emacs_path: &str, name: String) -> Self {
        let mut cmd = Command::new(emacs_path);
        cmd.arg(format!("--fg-daemon={}", name));

        // All daemon output is sent on stderr.
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().expect("Could not spawn emacs daemon");

        let stderr = child.stderr().take().expect("Could not get stderr");
        let stderr_reader = FramedRead::new(stderr, LinesCodec::new());
        Self {
            name,
            process: Some(child),
            stderr_reader,
        }
    }

    pub async fn read_until(&mut self, needle: &str) {
        loop {
            let data: String = self
                .stderr_reader
                .next()
                .await
                .unwrap_or_else(|| Ok(String::new()))
                .expect("failed to read line");

            debug!("({}) Read line: {}", self.name, data);

            if data.contains(needle) {
                break;
            }
        }
    }

    pub async fn shutdown(&mut self) {
        match self.process.take() {
            Some(mut p) => {
                // TODO: Send SIGTERM instead of SIGKILL.
                if let Err(e) = p.kill() {
                    error!("Failed to kill daemon {}: {:?}", &self.name, e);
                }
                // Need to wait for exit to avoid defunct processes.
                match p.wait_with_output().await {
                    Ok(output) => {
                        debug!("Daemon {} exited with status {}", &self.name, output.status);
                    }
                    Err(e) => {
                        error!("Error shutting down daemon {}: {:?}", &self.name, e);
                    }
                }
            }
            None => panic!("Shutdown called on dead daemon {}", &self.name),
        }
    }
}

async fn prepare_new_daemon(emacs_path: &str) -> Daemon {
    // TODO: Ensure the created name isn't already used.
    let mut name = String::from("pool-");
    name.push_str(rand::thread_rng().gen::<u32>().to_string().as_ref());

    let mut daemon = Daemon::new(emacs_path, name.clone());

    daemon.read_until("Starting Emacs daemon.").await;

    // Even after the "Starting Emacs daemon" message, the socket file
    // still takes a little time to create.
    sleep(Duration::from_millis(500)).await;

    info!("New daemon started: {}", &name);

    daemon
}

async fn handle_client(mut socket: UnixStream, mut daemon: Daemon) {
    info!("Got new client connection.");

    let daemon_name = &daemon.name;
    info!("Providing daemon: {}", daemon_name);

    // Send the daemon name, terminated by a newline.
    let mut daemon_str = String::from(daemon_name);
    daemon_str.push_str("\n");

    if let Err(e) = socket.write_all(daemon_str.as_bytes()).await {
        error!("Failed to write daemon info to client socket: {:?}", e);
    } else {
        // Wait for socket to close
        loop {
            let mut buf: [u8; 1024] = [0; 1024];
            match socket.read(&mut buf).await {
                Ok(_n) if _n == 0 => {
                    // Socket closed.
                    info!("Client connected to daemon {} has exited.", daemon_name);
                    break;
                }
                Ok(_) => {
                    continue;
                }
                Err(e) => {
                    error!(
                        "Failed to read from client socket (daemon {}): {:?}",
                        daemon_name, e
                    );
                    break;
                }
            };
        }
    }

    info!("Stopping daemon: {}", daemon_name);
    daemon.shutdown().await;
}

async fn run_daemon(sock_path: &str, emacs_path: &str, pool_size: usize) {
    debug!("Listening for clients at {}", sock_path);
    let mut listener = UnixListener::bind(sock_path).expect("Could not bind socket");

    let mut available_daemons: Vec<Daemon> = vec![];
    {
        info!("Preparing initial daemons..");

        let mut prepare_futures = vec![];
        for _ in 0..pool_size {
            prepare_futures.push(Box::pin(prepare_new_daemon(emacs_path)));
        }

        while !prepare_futures.is_empty() {
            let (prepared_daemon, _, remaining_futures) = future::select_all(prepare_futures).await;
            prepare_futures = remaining_futures;
            available_daemons.push(prepared_daemon);
        }
    }

    let mut sighup_future = Box::pin(signal(SignalKind::hangup()).unwrap().into_future());
    let mut sigint_future = Box::pin(signal(SignalKind::interrupt()).unwrap().into_future());
    let mut sigterm_future = Box::pin(signal(SignalKind::terminate()).unwrap().into_future());

    info!("Running main daemon loop..");

    loop {
        let mut accept_future = Box::pin(listener.accept().fuse());
        let mut new_daemon_future = Box::pin(if available_daemons.len() < pool_size {
            prepare_new_daemon(emacs_path).fuse()
        } else {
            future::Fuse::terminated()
        });

        select! {
            new_client = accept_future => {
                let (mut socket, _) = new_client.unwrap();
                let daemon_opt = available_daemons.pop();
                let cloned_path = emacs_path.to_string();
                tokio::spawn(async move {
                    let daemon = match daemon_opt {
                        Some(daemon) => daemon,
                        None => {
                            info!("No daemons were prepared, spawning immediately..");
                            prepare_new_daemon(&cloned_path).await
                        }
                    };
                    handle_client(socket, daemon).await;
                });
            }
            new_daemon = new_daemon_future => {
                available_daemons.push(new_daemon);
            }
            _ = sighup_future => break,
            _ = sigint_future => break,
            _ = sigterm_future => break
        }
    }

    info!("Shutting down..");
    future::join_all(
        available_daemons
            .iter_mut()
            .map(Daemon::shutdown)
            .map(Box::pin),
    )
    .await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();

    let args = App::new("emacs-pool-daemon")
        .arg(
            Arg::with_name("sock")
                .short("s")
                .long("sock")
                .value_name("PATH")
                .help(&format!(
                    "Sets the socket path (Default: $HOME/{})",
                    default_sock_filename()
                ))
                .takes_value(true),
        )
        .arg(
            Arg::with_name("emacs-path")
                .short("e")
                .long("emacs")
                .value_name("FILE")
                .help("Sets emacs binary location")
                .takes_value(true),
        )
        .arg(
            Arg::with_name("pool-size")
                .short("p")
                .long("pool-size")
                .value_name("NUMBER")
                .help(&format!(
                    "Sets the daemon pool size (Default: {})",
                    DEFAULT_POOL_SIZE
                ))
                .takes_value(true),
        )
        .get_matches();

    let sock_path = args
        .value_of("sock")
        .map(|val| val.to_string())
        .unwrap_or_else(default_sock_path);

    let emacs_path = args.value_of("emacs-path").unwrap_or("emacs");

    let pool_size = args
        .value_of("pool_size")
        .unwrap_or(DEFAULT_POOL_SIZE.to_string().as_ref())
        .parse::<usize>()
        .expect("Pool size is not a valid number");

    run_daemon(&sock_path, emacs_path, pool_size).await;

    fs::remove_file(&sock_path).unwrap();

    Ok(())
}
