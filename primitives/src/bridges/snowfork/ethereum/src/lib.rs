#![cfg_attr(not(feature = "std"), no_std)]

pub mod difficulty;
pub mod ethashdata;
pub mod ethashproof;
pub mod header;
pub mod log;
mod mpt;
pub mod receipt;

pub use ethereum_types::{Address, H160, H256, H64, U256};
// pub use sp_core::{H160, H256, H64, U256};
// pub use ethereum_types::{Address};

pub use header::{Bloom, Header, HeaderId};
pub use log::Log;
pub use receipt::Receipt;

#[derive(Debug)]
pub enum DecodeError {
    // Unexpected RLP data
    InvalidRLP(rlp::DecoderError),
    // Data does not match expected ABI
    InvalidABI(ethabi::Error),
    // Invalid message payload
    InvalidPayload,
}

impl From<rlp::DecoderError> for DecodeError {
    fn from(err: rlp::DecoderError) -> Self {
        DecodeError::InvalidRLP(err)
    }
}

impl From<ethabi::Error> for DecodeError {
    fn from(err: ethabi::Error) -> Self {
        DecodeError::InvalidABI(err)
    }
}