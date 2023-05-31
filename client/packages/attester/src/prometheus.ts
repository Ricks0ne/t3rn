import client from 'prom-client'
import http from 'http'
import { logger } from './logging'
export class Prometheus {
    circuitActive: boolean
    targetActive: boolean
    targetDisconnectsTotal: any
    circuitDisconnectsTotal: any
    register: any
    circuitHeight: any
    targetHeight: any
    circuitDisconnected: any
    target: string

    constructor(target: string) {
        this.target = target
        const Registry = client.Registry
        this.register = new Registry()
        this.createMetrics()
    }

    createMetrics() {
        const collectDefaultMetrics = client.collectDefaultMetrics
        collectDefaultMetrics({ register: this.register })
        this.circuitHeight = new client.Gauge({
            name: 'circuit_height',
            help: 'The header height stored on circuit',
            registers: [this.register],
            labelNames: [],
        })

        this.targetHeight = new client.Gauge({
            name: 'target_height',
            help: 'The current header height on the target',
            registers: [this.register],
            labelNames: [],
        })

        this.circuitDisconnected = new client.Counter({
            name: 'circuit_disconnect',
            help: 'Information on circuit disconnections',
            registers: [this.register],
            labelNames: ['endpoint'],
        })

        this.circuitDisconnectsTotal = new client.Counter({
            name: 'circuit_disconnects_total',
            help: 'Number of times circuit rpc server has disconnected',
            registers: [this.register],
            labelNames: [],
        })

        this.startServer()
    }

    startServer() {
        const server = http.createServer(async (req, res) => {
            try {
                if (req.url === '/metrics') {
                    res.setHeader('Content-Type', this.register.contentType)
                    const metrics = await this.register.metrics()
                    res.end(metrics)
                } else if (req.url === '/healthz') {
                    res.setHeader('Content-Type', 'text/plain')
                    res.statusCode = this.circuitActive ? 200 : 500
                    res.end(
                        JSON.stringify({
                            circuitActive: this.circuitActive,
                        })
                    )
                } else {
                    res.statusCode = 404
                    res.end('Not found.')
                }
            } catch (error) {
                res.statusCode = 500
                res.end(error.toString())
            }
        })

        const port = 8080
        server.listen(port, () => {
            logger.info(`Metrics server listening on port ${port}`)
        })
    }
}
