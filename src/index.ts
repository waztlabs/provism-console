import crypto from 'crypto'
import tls, { type TLSSocket } from 'tls'
import type { WebSocket } from 'ws'

import fastify, { FastifyRequest } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'

import dotenv from 'dotenv'
dotenv.config()

////////////////////////////////////////////////

const app = fastify({ logger: false })
app.register(fastifyCors)
app.register(fastifyWebsocket)

////////////////////////////////////////////////

const generateId = () => crypto.randomBytes(16).toString('hex')

interface CachedConsole {
  uuid: string
  socket?: TLSSocket
  isConnected?: boolean
  hostname: string
  port: number
  consolePath: string
}

const vConsoles: CachedConsole[] = []

////////////////////////////////////////////////

const handleConsole = (vConsole: CachedConsole, socket: TLSSocket, ws: WebSocket) => {
  let dataRecv = ''
  let detectHttp = false

  socket.on('end', () => {
    console.log('### Socket End.')
    ws.close()
  })

  socket.on('data', (data) => {
    // console.log('<<H', Buffer.from(data).toString('hex'))
    // console.log('<<S', JSON.stringify([data.toString()]))

    if (!detectHttp) {
      console.log('<<S', JSON.stringify([data.toString()]))
      dataRecv += data.toString()
      if (dataRecv.includes('HTTP/1.1 200 OK') && dataRecv.includes('\r\n\r\n')) {
        detectHttp = true
        console.log('### Detected HTTP', JSON.stringify([dataRecv]))
      }
      return
    }

    ws.send(data)
  })

  ws.on('message', (data) => {
    // console.log('S>>', JSON.stringify([data.toString()]))
    socket.write(data as Uint8Array)
  })

  ws.on('close', () => {
    socket.destroy()
  })

  socket.write([
    `CONNECT ${vConsole.consolePath} HTTP/1.0`,
    `Host: ${vConsole.hostname}`,
    // `Cookie: session_id=OpaqueRef:XXX`,
    '', ''
  ].join('\r\n'))
}

////////////////////////////////////////////////

app.get('/', (_, reply) => {
  reply.send('Welcome to Provism Console (maythiwat.com)')
})

app.get('/list', (_, reply) => {
  reply.send(vConsoles)
})

app.get('/clear', (_, reply) => {
  vConsoles.splice(0, vConsoles.length)
  reply.send(vConsoles)
})

app.get('/add', (request: FastifyRequest<{ Querystring: { host: string, port: string, path: string } }>, reply) => {
  if (!request.query.host || !request.query.port || !request.query.path) {
    reply.status(400).send('error: host, port, path is required.')
    return
  }

  let vConsole: CachedConsole = {
    uuid: generateId(),
    hostname: request.query.host,
    port: parseInt(request.query.port),
    consolePath: request.query.path,
  }

  vConsoles.push(vConsole)

  let vncLiteCode = Buffer.from(JSON.stringify({
    host: process.env.CONSOLE_HOST,
    port: process.env.CONSOLE_PORT,
    path: '/console',
    uuid: vConsole.uuid
  })).toString('base64')

  reply.status(200).send({
    uuid: vConsole.uuid,
    code: vncLiteCode
  })
})

app.get('/console', { websocket: true }, (connection, request: FastifyRequest<{ Querystring: { uuid: string } }>) => {
  const ws = connection.socket
  const vConsole = vConsoles.find(c => c.uuid == request.query.uuid)

  if (!request.query.uuid || !vConsole) {
    ws.close(1003, 'invalid console uuid')
    return
  }

  const socket = tls.connect({
    host: vConsole.hostname,
    port: 443,
    rejectUnauthorized: false
  }, () => {
    handleConsole(vConsole, socket, ws)
  })

  socket.on('error', e => {
    console.log(e)
    ws.close(1001, 'console transport error')
  })
})

////////////////////////////////////////////////

app.listen({
  host: process.env.HOST || 'localhost',
  port: Number(process.env.PORT) || 3000
}, (error, address) => {
  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log('> Listening on:', address)
})