// Copyright 2019-2021 Parity Technologies (UK) Ltd.
// This file is part of Parity Bridges Common.

// Parity Bridges Common is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Parity Bridges Common is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Parity Bridges Common.  If not, see <http://www.gnu.org/licenses/>.

//! Autogenerated weights for pallet_bridge_grandpa
//!
//! THIS FILE WAS AUTO-GENERATED USING THE SUBSTRATE BENCHMARK CLI VERSION 3.0.0
//! DATE: 2021-04-02, STEPS: [50, ], REPEAT: 20
//! LOW RANGE: [], HIGH RANGE: []
//! EXECUTION: Some(Wasm), WASM-EXECUTION: Compiled
//! CHAIN: Some("dev"), DB CACHE: 128

// Executed Command:
// ./target/release/rialto-bridge-node
// benchmark
// --chain
// dev
// --execution
// wasm
// --extrinsic
// *
// --pallet
// pallet_bridge_grandpa
// --wasm-execution
// compiled
// --steps
// 50
// --repeat
// 20
// --template
// ./.maintain/rialto-weight-template.hbs
// --output
// ./grandpa-template.txt
// --raw

#![allow(clippy::all)]
#![allow(unused_parens)]
#![allow(unused_imports)]

use frame_support::{
	traits::Get,
	weights::{constants::RocksDbWeight, Weight},
};
use sp_std::marker::PhantomData;

/// Weight functions needed for pallet_bridge_grandpa.
pub trait WeightInfo {
	fn submit_finality_proof(v: u32, p: u32) -> Weight;
	fn submit_finality_proof_on_single_fork(v: u32) -> Weight;
	fn submit_finality_proof_on_many_forks(p: u32) -> Weight;
	fn find_scheduled_change(n: u32) -> Weight;
	fn read_write_authority_sets(n: u32) -> Weight;
}

/// Weights for pallet_bridge_grandpa using the Rialto node and recommended hardware.
pub struct GatewayWeight<T>(PhantomData<T>);
impl<T: frame_system::Config> WeightInfo for GatewayWeight<T> {
	fn submit_finality_proof(v: u32, p: u32) -> Weight {
		(0 as Weight)
			.saturating_add((160_060_000 as Weight).saturating_mul(v as Weight))
			.saturating_add((640_223_000 as Weight).saturating_mul(p as Weight))
			.saturating_add(T::DbWeight::get().reads(5 as Weight))
			.saturating_add(T::DbWeight::get().writes(3 as Weight))
	}
	fn submit_finality_proof_on_single_fork(v: u32) -> Weight {
		(189_597_000 as Weight)
			.saturating_add((11_680_000 as Weight).saturating_mul(v as Weight))
			.saturating_add(T::DbWeight::get().reads(5 as Weight))
			.saturating_add(T::DbWeight::get().writes(3 as Weight))
	}
	fn submit_finality_proof_on_many_forks(p: u32) -> Weight {
		(0 as Weight)
			.saturating_add((130_061_000 as Weight).saturating_mul(p as Weight))
			.saturating_add(T::DbWeight::get().reads(5 as Weight))
			.saturating_add(T::DbWeight::get().writes(3 as Weight))
	}
	fn find_scheduled_change(n: u32) -> Weight {
		(502_000 as Weight).saturating_add((8_000 as Weight).saturating_mul(n as Weight))
	}
	fn read_write_authority_sets(n: u32) -> Weight {
		(7_677_000 as Weight)
			.saturating_add((230_000 as Weight).saturating_mul(n as Weight))
			.saturating_add(T::DbWeight::get().reads(1 as Weight))
			.saturating_add(T::DbWeight::get().writes(1 as Weight))
	}
}

// For backwards compatibility and tests
impl WeightInfo for () {
	fn submit_finality_proof(v: u32, p: u32) -> Weight {
		(0 as Weight)
			.saturating_add((160_060_000 as Weight).saturating_mul(v as Weight))
			.saturating_add((640_223_000 as Weight).saturating_mul(p as Weight))
			.saturating_add(RocksDbWeight::get().reads(5 as Weight))
			.saturating_add(RocksDbWeight::get().writes(3 as Weight))
	}
	fn submit_finality_proof_on_single_fork(v: u32) -> Weight {
		(189_597_000 as Weight)
			.saturating_add((11_680_000 as Weight).saturating_mul(v as Weight))
			.saturating_add(RocksDbWeight::get().reads(5 as Weight))
			.saturating_add(RocksDbWeight::get().writes(3 as Weight))
	}
	fn submit_finality_proof_on_many_forks(p: u32) -> Weight {
		(0 as Weight)
			.saturating_add((130_061_000 as Weight).saturating_mul(p as Weight))
			.saturating_add(RocksDbWeight::get().reads(5 as Weight))
			.saturating_add(RocksDbWeight::get().writes(3 as Weight))
	}
	fn find_scheduled_change(n: u32) -> Weight {
		(502_000 as Weight).saturating_add((8_000 as Weight).saturating_mul(n as Weight))
	}
	fn read_write_authority_sets(n: u32) -> Weight {
		(7_677_000 as Weight)
			.saturating_add((230_000 as Weight).saturating_mul(n as Weight))
			.saturating_add(RocksDbWeight::get().reads(1 as Weight))
			.saturating_add(RocksDbWeight::get().writes(1 as Weight))
	}
}
