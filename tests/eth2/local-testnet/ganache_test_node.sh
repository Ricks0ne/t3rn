#!/usr/bin/env bash

set -Eeuo pipefail

source ./vars.env

exec ganache \
	--defaultBalanceEther 10000000 \
	--gasLimit 1000000000 \
	--accounts 10 \
	--host 0.0.0.0 \
	--mnemonic "$ETH1_NETWORK_MNEMONIC" \
	--port 8545 \
	--blockTime $SECONDS_PER_ETH1_BLOCK \
	--chain.chainId "$CHAIN_ID"
