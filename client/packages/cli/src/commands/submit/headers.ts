import ora from "ora"
import { SingleBar, Presets } from "cli-progress"
import { getConfig } from "@/utils/config.ts"
import { colorLogMsg, log } from "@/utils/log.ts"
import { createCircuitContext } from "@/utils/circuit.ts"
import { Gateway } from "@/schemas/setup.ts"
import { Circuit } from "@/types.ts"
import { Encodings, ApiPromise, WsProvider } from "@t3rn/sdk"

export const spinner = ora()
export const progressBar = new SingleBar({}, Presets.shades_classic)

export const handleSubmitHeadersCmd = async (gatewayId: string) => {
  const config = getConfig()
  if (!config) {
    process.exit(1)
  }

  const gateway = config.gateways.find((g) => g.id === gatewayId)
  if (!gateway) {
    log("ERROR", `Gateway with id ${gatewayId} not found in config`)
    process.exit(1)
  }

  if (gateway.registrationData.parachain) {
    log("ERROR", "Headers can only be submitted for a relaychain not parachain")
    process.exit(1)
  }

  const { circuit, sdk } = await createCircuitContext()

  try {
    const transactionArguments = await getHeaders(circuit, gateway)

    spinner.start(`Submitting headers for ${gatewayId}`)

    const bridge = getBridge(circuit, gatewayId)
    const tx = sdk.circuit.tx.createBatch(
      transactionArguments.map((args) => {
        return bridge.submitHeaders(
          args.range,
          args.signed_header,
          args.justification
        )
      })
    )
    await sdk.circuit.tx.signAndSendSafe(tx)

    spinner.succeed(
      colorLogMsg("SUCCESS", `Header range submitted for ${gatewayId}!`)
    )
    process.exit(0)
  } catch (e) {
    spinner.fail(
      colorLogMsg("ERROR", `Failed to submit headers for ${gateway}: ${e}`)
    )
    process.exit(1)
  }
}

export const getHeaders = async (circuit: Circuit, gateway: Gateway) => {
  switch (gateway.registrationData.executionVendor) {
    case "Substrate": {
      const targetApi = await ApiPromise.create({
        provider: new WsProvider(gateway.rpc),
      })

      return getRelayChainHeaders(circuit, targetApi, gateway.id)
    }
    default:
      throw new Error(
        `Verification vendor ${gateway.registrationData.verificationVendor} not supported`
      )
  }
}

export const getBridge = (circuit: Circuit, gatewayId: string) => {
  const config = getConfig()
  if (!config) {
    return
  }

  const gateway = config.gateways.find((g) => g.id === gatewayId)
  if (!gateway) {
    return
  }

  const verificationVendor = gateway.registrationData.verificationVendor
  switch (verificationVendor) {
    case "Kusama":
      return circuit.query.kusamaBridge
    case "Rococo":
      return circuit.query.rococoBridge
    case "Polkadot":
      return circuit.query.polkadotBridge
  }
}

const getRelayChainHeaders = async (
  circuit: Circuit,
  target: ApiPromise,
  gatewayId: string
) => {
  const from = (await getGatewayHeight(circuit, gatewayId)) + 1
  const to = await getTargetCurrentHeight(target)
  const transactionArguments = await generateBatchProof(
    circuit,
    target,
    gatewayId,
    from,
    to
  )

  return transactionArguments.length > 10
    ? transactionArguments.slice(0, 10)
    : transactionArguments
}

const getGatewayHeight = async (circuit: Circuit, gatewayId: string) => {
  const bridge = getBridge(circuit, gatewayId)
  const hash = await bridge.bestFinalizedHash()
  const height = await bridge.importedHeaders(hash.toJSON())

  if (height.toJSON()) {
    //@ts-ignore - TS doesn't know that height.toJSON() has a number property
    return height.toJSON().number
  }

  throw new Error("Gateway not Registered!")
}

const getTargetCurrentHeight = async (target: ApiPromise) => {
  const header = await target.rpc.chain.getHeader(
    await target.rpc.chain.getFinalizedHead()
  )
  return header.number.toNumber()
}

const generateBatchProof = async (
  circuit: Circuit,
  target: ApiPromise,
  gatewayId: string,
  from: number,
  to: number
) => {
  const transactionArguments = []
  const logMsg = {
    type: "RELAYCHAIN",
    gatewayId,
    latestCircuit: from,
    latestTarget: to,
    batches: [],
  }

  spinner.info(
    colorLogMsg(
      "INFO",
      `Obtaining batch proofs for ${gatewayId} from Block #${from} to #${to}`
    )
  )
  progressBar.start(to - from, 0)

  while (from <= to) {
    if (logMsg.batches.length > 0) {
      const progress = logMsg.batches[logMsg.batches.length - 1]
      const delta = progress.targetTo - progress.targetFrom
      progressBar.increment(logMsg.batches.length === 1 ? delta * 2 : delta)
    }

    // Get finalityProof element of epoch that contains block #from
    const finalityProof = await target.rpc.grandpa.proveFinality(from)

    // Decode finality proof
    let { justification, headers } =
      Encodings.Substrate.Decoders.finalityProofDecode(finalityProof)
    const signed_header = headers.pop()

    // Query from header again, as its not part of the proof then concat
    headers = [await getTargetHeader(target, from), ...headers]

    const range = circuit.createType("Vec<Header>", headers)

    logMsg.batches.push({
      // @ts-ignore - TS doesn't know that range is a Vec<Header>
      targetFrom: range[0].number.toNumber(),
      // @ts-ignore - TS doesn't know that range is a Vec<Header>
      targetTo: range[range.length - 1].number.toNumber(),
    })
    justification =
      Encodings.Substrate.Decoders.justificationDecode(justification)

    // Push to transaction queue
    transactionArguments.push({
      gatewayId: circuit.createType("ChainId", gatewayId),
      signed_header,
      range,
      justification,
    })

    // Increment from
    from = parseInt(signed_header.number.toJSON()) + 1
  }

  progressBar.stop()

  return transactionArguments
}

const getTargetHeader = async (target: ApiPromise, height: number) => {
  return (
    await target.rpc.chain.getHeader(
      await target.rpc.chain.getBlockHash(height)
    )
  ).toJSON()
}