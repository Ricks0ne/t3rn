import "@t3rn/types";
// @ts-ignore - Typescript does not know about this type
import { T3rnTypesSideEffect } from "@polkadot/types/lookup";
import { TextDecoder } from "util";
import {
  SecurityLevel,
  SfxStatus,
  SfxType,
} from "@t3rn/sdk/side-effects/types";
import { Sdk } from "@t3rn/sdk";
import { BehaviorSubject } from "rxjs";
import { Gateway } from "@t3rn/sdk/gateways";
import { StrategyEngine } from "../strategy";
import { BiddingEngine } from "../bidding";
import { EventEmitter } from "events";
import { floatToBn } from "@t3rn/sdk/circuit";
import { bnToFloat } from "@t3rn/sdk/converters/amounts";
import { InclusionProof } from "../gateways/types";
import { Logger } from "pino";
import { Subscription } from "rxjs";
import { Codec } from "@polkadot/types/types";
import { BN } from "@polkadot/util";
import { Prometheus } from "../prometheus";
import { logger } from "../logging";
import { config } from "../../config/config";

/** Map event names to SfxType enum */
export const EventMapper = ["Transfer", "MultiTransfer"];

/**
 * Type used for representing a Txoutput
 *
 * @typedef {Object} TxOutput
 * @group Execution Manager
 */
export type TxOutput = {
  /** Output amount as integer */
  amount: bigint;
  /** Output amount in human-readable float */
  amountHuman: number;
  /** Output asset ticker */
  asset: string;
  /** Reward asset ticker */
  rewardAsset: string;
  /** Reward amount in human-readable float */
  rewardAmount: number;
};

/**
 * Event notifications
 *
 * @group Execution Manager
 */
export enum NotificationType {
  SubmitBid,
}

/**
 * Status for executing a side effect
 *
 * @group Execution Manager
 */
export enum TxStatus {
  /** The execution is currently pending, meaning another instance is in progress */
  Pending,
  /** The execution ready to be submitted */
  Ready,
}

/**
 * Event notification type
 *
 * @group Execution Manager
 */
export type Notification = {
  type: NotificationType;
  payload: {
    sfxId: string;
    bidAmount: number | BN;
  };
};

/**
 * Class used for tracking the state of a side effect. It contains all needed data and helper functions to go through the lifecycle of a XTX.
 *
 * @group Execution Manager
 */
export class SideEffect extends EventEmitter {
  /** The phase in which the SFX is part of. First Escrow, then Optimistic */
  phase: number;
  /** SFX status, always starting with Bidding on creation */
  status: SfxStatus = SfxStatus.InBidding;
  /** SFX action, e.g. tran, swap, etc */
  action: SfxType;
  /** Acts as mutex lock to prevent parallel txs on the same SFX */
  txStatus: TxStatus = TxStatus.Ready;
  /** Target gateway of the SFX */
  target: string;
  /** The id of the gateway running the targets consensus, e.g. roco for bslk tx */
  vendor: string;
  /** Gateway helper instance */
  gateway: Gateway;
  /** Security Level, e.g. Escrow or Optimistic */
  securityLevel: SecurityLevel;
  /** Is currently the winning bidder of the SFX */
  isBidder = false;
  /** The minimum profit in USD required for executing this SFX. Number is computed by strategy engine */
  minProfitUsd = 0;

  /** If the executor leading the bid changes, store the change */
  changedBidLeader = false;
  /** Value of the last bid */
  lastBids: number[] = [];

  // SideEffect data
  id: string;
  humanId: string;
  xtxId: string;
  /** Encoded arguments, containing the description of what should be executed */
  arguments: string[];
  /** Insurance required for executing this SFX. Amount is deposited throughout the XTX lifecycle and refunded on confirmation */
  insurance: number;
  /** The current reward paid by the user for executing this SFX. This amount can reduce through executor bidding */
  reward: BehaviorSubject<number>;
  /** The reward asset, e.g. TRN */
  maybeRewardAsset: number;
  /** The raw SideEffect, encoded in SCALE */
  raw: T3rnTypesSideEffect;

  // TargetConfirmation
  /** Required data for confirming the inclusion on circuit. contains encoded payload, inclusionProof, and blockHash */
  inclusionProof: InclusionProof;
  /** The block number in which the SFX was included on the target */
  targetInclusionHeight = 0;
  /** The address of this SFXs executor */
  executor: string;

  // Risk/Reward Parameters:
  /** Tx cost in the native currency of the target */
  txCostNative: BehaviorSubject<number>;
  /** Cost of targets native asset in USD. Used for tx cost calculation */
  nativeAssetPrice: BehaviorSubject<number>;
  /** Current price of the assets that are used for the sfx execution */
  txOutputAssetPrice: BehaviorSubject<number>;
  /** Current max profit in USD that can be made when executing */
  maxProfitUsd: BehaviorSubject<number> = new BehaviorSubject<number>(0);
  /** Price for reward assert in USD */
  rewardAssetPrice: BehaviorSubject<number> = new BehaviorSubject<number>(0);

  subscriptions: Array<Subscription> = [];
  /** Tx cost in USD */
  txCostUsd = 0;
  /** Cost of output assets in USD */
  txOutputCostUsd = 0;
  /** Total reward value in USD. This is not profit, as it includes the payment for the assets that are being spent/output by the executor */
  rewardUsd = 0;

  /** Tx receipt of the execution on target */
  txReceipt: unknown; // store tx receipt

  prometheus: Prometheus;

  /**
   * @param sideEffect Scale encoded side effect
   * @param id Id of the SFX
   * @param xtxId Id of the SFXs XTX
   * @param sdk Executor of @t3rn/sdk
   * @param strategyEngine Executor of the strategy engine
   * @param biddingEngine Executor of the bidding engine
   * @param circuitSignerAddress Address of the executor account used for transaction on circuit
   * @param logger The logger instance
   * @returns SideEffect instance
   */

  constructor(
    sideEffect: T3rnTypesSideEffect,
    id: string,
    xtxId: string,
    sdk: Sdk,
    public strategyEngine: StrategyEngine,
    public biddingEngine: BiddingEngine,
    public circuitSignerAddress: string,
    public logger: Logger,
    prometheus: Prometheus,
  ) {
    super();
    if (this.decodeAction(sideEffect.action)) {
      this.raw = sideEffect;
      this.id = id;
      this.humanId = id.substring(0, 8);
      this.xtxId = xtxId;
      this.arguments = sideEffect.encodedArgs.map((entry: SideEffect) =>
        entry.toString(),
      );
      this.target = new TextDecoder().decode(sideEffect.target.toU8a());
      this.gateway = sdk.gateways[this.target];
      this.reward = new BehaviorSubject(
        sdk.circuit.toFloat(sideEffect.maxReward),
      );
      this.maybeRewardAsset = sideEffect.rewardAssetId || 0;
      this.insurance = sdk.circuit.toFloat(sideEffect.insurance); // this is always in TRN (native asset)
      this.strategyEngine = strategyEngine;
      this.biddingEngine = biddingEngine;
      this.circuitSignerAddress = circuitSignerAddress;
      this.vendor = this.gateway.vendor;
      this.prometheus = prometheus;
    }
  }

  /**
   * Set the correct phase index
   *
   * @param phase The index of the SFXs phase
   */
  setPhase(phase: number) {
    this.phase = phase;
  }

  /**
   * Adds the required risk parameter subjects to the SFX instance. These values are used to determine if the SFX is profitable to
   * execute. The values are added as subjects to allow for dynamic updates, triggering the re-evaluation of the SFXs profitability.
   *
   * @param txCostNative Tx cost in the native currency of the target
   * @param nativeAssetPrice Cost of targets native asset in USD. Used for tx cost calculation
   * @param txOutputAssetPrice Current price of the assets that are used for the sfx execution
   * @param rewardAssetPrice Price for reward assert in USD
   */
  setRiskRewardParameters(
    txCostNative: BehaviorSubject<number>,
    nativeAssetPrice: BehaviorSubject<number>,
    txOutputAssetPrice: BehaviorSubject<number>,
    rewardAssetPrice: BehaviorSubject<number>,
  ) {
    this.txCostNative = txCostNative;
    this.nativeAssetPrice = nativeAssetPrice;
    this.txOutputAssetPrice = txOutputAssetPrice;
    this.rewardAssetPrice = rewardAssetPrice;

    // Wrap the subjects in a subscription to trigger the re-evaluation of the SFXs profitability in try catch loop
    try {
      logger.info(
        {
          txCostNative: txCostNative.getValue(),
          nativeAssetPrice: nativeAssetPrice.getValue(),
          txOutputAssetPrice: txOutputAssetPrice.getValue(),
          rewardAssetPrice: rewardAssetPrice.getValue(),
          xtxId: this.xtxId,
        },
        "Set risk parameters and subscriptions",
      );
    } catch (error) {
      logger.error(
        error.stack,
        "Error getting price values in SideEffect.setRiskRewardParameters",
      );
      return;
    }
    const txCostNativeSubscription = this.txCostNative.subscribe(() => {
      this.recomputeMaxProfit();
    });

    this.subscriptions.push(txCostNativeSubscription);

    const nativeAssetPriceSubscription = this.nativeAssetPrice.subscribe(() => {
      this.recomputeMaxProfit();
    });

    this.subscriptions.push(nativeAssetPriceSubscription);

    const txOutputAssetPriceSubscription = this.txOutputAssetPrice.subscribe(
      () => {
        this.recomputeMaxProfit();
      },
    );

    this.subscriptions.push(txOutputAssetPriceSubscription);

    const rewardAssetPriceSubscription = this.rewardAssetPrice.subscribe(() => {
      this.recomputeMaxProfit();
    });

    this.subscriptions.push(rewardAssetPriceSubscription);

    const rewardSubscription = this.reward.subscribe(() => {
      this.recomputeMaxProfit();
    });

    this.subscriptions.push(rewardSubscription);

    this.recomputeMaxProfit();
  }

  /**
   * Computes the potential profit of the SFX based on the current risk/reward parameters. This function is primarily used to react to
   * changes in the risk/reward parameters and reevalute the bidding decision. If a new maxProfit has been computed, the bidding engine is
   * used to determine if another bid should be placed.
   */
  recomputeMaxProfit() {
    logger.info("🪆 Recomputing max profit");
    const txCostUsd =
      this.gateway.toFloat(this.txCostNative.getValue()) *
      this.nativeAssetPrice.getValue();
    this.txCostUsd = txCostUsd;
    const txOutputCostUsd =
      this.txOutputAssetPrice.getValue() *
      this.getTxOutputs(config.assetIdToTickerMap).amountHuman;
    this.txOutputCostUsd = txOutputCostUsd;
    const rewardValueUsd =
      this.rewardAssetPrice.getValue() * this.reward.getValue();
    this.rewardUsd = rewardValueUsd;
    const maxProfitUsd = rewardValueUsd - txCostUsd - txOutputCostUsd;
    if (maxProfitUsd !== this.maxProfitUsd.getValue()) {
      this.maxProfitUsd.next(maxProfitUsd);
      this.triggerBid();
    }
  }

  /** Triggers the bidding engine to place a new bid for the SFX. */
  triggerBid() {
    let result;
    try {
      result = this.generateBid();
    } catch (e) {
      logger.error(e.stack, "👱 Error generating bid in SideEffect.triggerBid");
      return;
    }
    if (result?.trigger) {
      logger.info(
        {
          xtxId: this.xtxId,
          bidAmount: bnToFloat(result.bidAmount as BN, 12),
        },
        `Bidding TRN 🎰`,
      );

      this.emit("Notification", {
        type: NotificationType.SubmitBid,
        payload: {
          sfxId: this.id,
          bidAmount: result.bidAmount, // converts human to native
        },
      });
    } else {
      logger.info({ reason: result.reason }, "Not bidding");
    }
  }

  /**
   * Evaluate the SFX via the strategy engine. If the SFX passes all constraints defined by the executor, the bidding engine is triggered,
   * computing the bid price. The bid price is then returned
   *
   * @private
   * @returns Any
   */
  // ToDo fix return type
  private generateBid() {
    if (this.isBidder) {
      this.prometheus.executorBid.inc({ scenario: "Already a bidder" });
      return { trigger: false, reason: "Already a bidder" };
    }
    if (this.txStatus !== TxStatus.Ready) {
      this.prometheus.executorBid.inc({ scenario: "TX not ready" });
      return { trigger: false, reason: "Tx not ready" };
    }
    if (this.status !== SfxStatus.InBidding) {
      this.prometheus.executorBid.inc({ scenario: "Not in bidding phase" });
      return { trigger: false, reason: "Not in bidding phase" };
    }
    try {
      this.strategyEngine.evaluateSfx(this);
    } catch (e) {
      this.prometheus.executorBid.inc({ scenario: "Not bidding" });
      logger.info({ sfxId: this.id }, `SFX Not bidding `);
      return { trigger: false, reason: e.toString() };
    }

    // we have passed all checks and need to compute the bid amount
    this.txStatus = TxStatus.Pending; // acts as mutex lock
    this.minProfitUsd = this.strategyEngine.getMinProfitUsd(this);

    const bidUsd = this.biddingEngine.computeBid(this);
    const bidRewardAsset = bidUsd / this.rewardAssetPrice.getValue();
    this.prometheus.executorBid.inc({ scenario: "Generated bid" });

    return { trigger: true, bidAmount: floatToBn(bidRewardAsset) };
  }

  /**
   * Generate an array of arguments for the SFX execution.
   *
   * @returns Any[] - Array of arguments for the SFX execution in the corresponding type
   */
  execute() {
    switch (this.action) {
      case SfxType.Transfer: {
        return this.getTransferArguments();
      }
      case SfxType.TransferAsset: {
        return this.getTransferAssetArguments();
      }
      case SfxType.CallEVM: {
        return this.getCallArguments();
      }
      case SfxType.CallWASM: {
        return this.getCallArguments();
      }
      case SfxType.CallGeneric: {
        return this.getCallArguments();
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Returns TxOutput containing the outputs required for a SFXs execution
   *
   * @returns TxOutput.
   */
  getTxOutputs(assetIdToTickerMap: { [assetId: number]: string }): TxOutput {
    switch (this.action) {
      case SfxType.Transfer: {
        let amount = this.getTransferArguments()[1];
        amount = parseInt(amount.toString());
        return {
          amount: BigInt(amount),
          amountHuman: this.gateway.toFloat(amount), // converts to human format
          asset: this.gateway.ticker,
          rewardAsset: "TRN",
          rewardAmount: this.reward.getValue(),
        };
      }
      case SfxType.TransferAsset: {
        const transferAssetArguments = this.getTransferAssetArguments();
        const assetId = transferAssetArguments[0];
        const assetTicker = assetIdToTickerMap[assetId];
        const targetAmount = transferAssetArguments[2];
        const amount = parseInt(targetAmount.toString());
        const rewardAssetTicker =
          assetIdToTickerMap[this.maybeRewardAsset] || "TRN";
        return {
          amount: BigInt(amount),
          amountHuman: this.gateway.toFloat(amount), // converts to human format
          asset: assetTicker,
          rewardAsset: rewardAssetTicker,
          rewardAmount: this.reward.getValue(),
        };
      }
      default: {
        return {
          amount: BigInt(0),
          amountHuman: 0,
          asset: "",
          rewardAsset: "TRN",
          rewardAmount: 0,
        };
      }
    }
  }

  /**
   * Perform state updates if our bid has been accepted.
   *
   * @param bidAmount The bidding amount that was accepted. This is the reward amount, which is added to the subject
   */
  bidAccepted(status, bidAmount: number) {
    this.txStatus = TxStatus.Ready; // open mutex lock

    // usually, event fire quicker then a TX resolves. This prevents that we overwrite the TX status, when a lower bid was in the same block
    if (this.reward.getValue() >= this.gateway.toFloat(bidAmount)) {
      this.isBidder = true;
      this.reward.next(this.gateway.toFloat(bidAmount)); // not sure if we want to do this tbh. Reacting to other bids should be sufficient
      this.prometheus.executorBid.inc({ scenario: "Accepted" });
      logger.info(
        {
          xtxId: this.xtxId,
          bidAmount: bidAmount.toString(),
          block: status.inBlock,
        },
        `Bid accepted ✅`,
      );
    } else {
      this.triggerBid(); // trigger another bid, as we have been outbid. The risk parameters are updated automatically by events.
      this.prometheus.executorBid.inc({ scenario: "Outbid" });
      logger.info(
        { xtxId: this.xtxId, bidAmount: bidAmount.toString() },
        `Bid undercut in block ❌`,
      );
    }
  }

  /**
   * Perform state updates if out bid has been rejected.
   *
   * @param error Error message used for logging
   */
  bidRejected() {
    // a better bid was submitted before this one was accepted. A new eval will be triggered with the incoming bid event
    this.txStatus = TxStatus.Ready; // open mutex lock
    this.isBidder = false;

    this.triggerBid();
  }

  /**
   * Process an incoming bid event. The bid amount is now the new reward amount and the SFX is evaluated again, potentially triggering a
   * counter bid.
   *
   * @param signer Signer of the incoming bid
   * @param bidAmount Amount of the incoming bid
   */
  processBid(signer: string, bidAmount: number) {
    // Add the executor bid to the list
    this.biddingEngine.storeWhoBidOnWhat(this.id, signer);
    // Add how much it bid
    this.lastBids.push(bidAmount);

    // if this is not own bid, update reward and isBidder
    if (signer !== this.circuitSignerAddress) {
      logger.info(
        {
          signer,
          bidAmount,
          sfxId: this.id,
          xtxId: this.xtxId,
        },
        `SFX Competing bid 🎰`,
      );
      this.prometheus.executorBid.inc({ scenario: "Competing" });
      logger.info({ signer, bidAmount }, "Competing bid received");
      this.isBidder = false;
      this.reward.next(this.gateway.toFloat(bidAmount)); // this will trigger the re-eval of submitting a new bid
    } else {
      this.prometheus.executorBid.inc({ scenario: "Own bid detected" });
      logger.warn({ signer, bidAmount }, "Own bid detected");
    }
  }

  /** Update the SFX status */
  readyToExecute() {
    this.status = SfxStatus.ReadyToExecute;
  }

  /**
   * SFX was successfully executed and the required proof data generated
   *
   * @param inclusionProof Inclusion proof data
   * @param executor Address of the executor on target
   * @param targetInclusionHeight Block height on target where transaction was included
   */
  executedOnTarget(
    inclusionProof: InclusionProof,
    executor: string,
    targetInclusionHeight: number,
  ) {
    this.inclusionProof = inclusionProof;
    this.executor = executor;
    this.targetInclusionHeight = targetInclusionHeight;
    this.status = SfxStatus.ExecutedOnTarget;
  }

  /** If the SFX required  */
  addHeaderProof(headerProof: string, blockHash: string) {
    this.inclusionProof.header_proof = { trieNodes: headerProof };
    this.inclusionProof.block_hash = blockHash;
  }

  /** SFX is confirmed, so wecan update the status and emit an event */
  confirmedOnCircuit() {
    this.status = SfxStatus.Confirmed;

    // unsubscribing from all subjects, as no longer needed
    this.unsubscribe();
  }

  /** Update the SFX status to dropped at bidding and unsubscribe all subjects */
  droppedAtBidding() {
    this.status = SfxStatus.Dropped;
    this.unsubscribe();
  }

  /** Update the SFX status to reverted and unsubscribe all subjects */
  reverted() {
    this.status = SfxStatus.Reverted;
    this.unsubscribe();
  }

  /** Maps action to enum */
  private decodeAction(action: Codec): boolean {
    switch (action.toHuman()) {
      case "tran": {
        this.action = SfxType.Transfer;
        return true;
      }
      case "tass": {
        this.action = SfxType.TransferAsset;
        return true;
      }
      case "cevm": {
        this.action = SfxType.CallEVM;
        return true;
      }
      case "wasm": {
        this.action = SfxType.CallWASM;
        return true;
      }
      case "call": {
        this.action = SfxType.CallGeneric;
        return true;
      }
      default: {
        return false;
      }
    }
  }

  // returns the arguments
  private getTransferArguments() {
    return [
      this.arguments[0],
      this.gateway.parseLe(this.arguments[1]).toNumber(),
    ];
  }

  private getTransferAssetArguments() {
    return [
      this.gateway.parseLe(this.arguments[0]).toNumber(), // Asset ID as u32
      this.arguments[0], // Target address
      this.gateway.parseLe(this.arguments[1]).toNumber(), // Amount as u128
    ];
  }

  private getCallArguments() {
    return [
      this.arguments[0], // Target address
      this.arguments[1], // Input
      this.gateway.parseLe(this.arguments[2]).toNumber(), // Amount as u128
      this.gateway.parseLe(this.arguments[3]).toNumber(), // Gas Amount u32
    ];
  }

  private unsubscribe() {
    this.subscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
  }
}
