//! Substrate Node Template CLI library.
use t7rn_parachain_collator::command;

fn main() -> sc_cli::Result<()> {
    command::run()
}
