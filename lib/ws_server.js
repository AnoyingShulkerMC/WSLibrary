import WSClientConnection from "./WSClientConnection.js"
import crypto from "node:crypto"
import EventEmitter from "node:events"
import { createServer, IncomingMessage, Server } from "node:http"
import { Socket } from "node:net"

function createHTTPResponse(headers) {
  var res = `HTTP/1.1 101 Switching Protocols\r\n`
  for (var [key, val] of Object.entries(headers)) {
    res += `${key}: ${val}\r\n`
  }
  res += "\r\n"
  return res
}
/**
 * 
 * @param {IncomingMessage} req
 * @param {Socket} socket
 * @returns {Promise<WSClientConnection>}
 */
function handleUpgrade(req, socket) {
  console.log("handlingUpgrade")
  return new Promise((resolve, reject) => {
    if (req.headers.upgrade.toLowerCase() !== "websocket" ||
      req.headers.upgrade === undefined ||
      !req.headers["sec-websocket-key"] ||
      req.headers["sec-websocket-version"] !== "13" ||
      !req.headers || 
      Buffer.from(req.headers["sec-websocket-key"], "base64").length !== 16) {
      socket.write(`HTTP/1.1 400 Bad Request\r\n\r\n`)
      socket.end()
      return reject(new Error("Websocket Handshake Failed"))
    }
    var hash = crypto.createHash("sha1")
    hash.update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    socket.write(createHTTPResponse({
      Connection: "upgrade",
      Upgrade: "WebSocket",
      "Sec-Websocket-Accept": hash.digest("base64")
    }), () => {
        resolve(new WSClientConnection(socket))
      })
  })
}
class WSServer extends EventEmitter {
  /**
   * 
   * @type {Array<WSClientConnection>} The clients currently connected to the network
   */
  clients = []
  /**
   * The WS server
   * @type {Server}
   */
  server;
  /**
   * 
   * @param {Object} [options]
   * @param {Server} [options.server]
   */
  constructor({ server } = {}) {
    super()
    this.server = server || createServer()
    this.server.on("upgrade", async (req, socket) => {
      var con = await handleUpgrade(req, socket)
      if (!this.emit("connection", con)) con.close(1000)
      this.clients.push(con)
      con.on("close", (code, reason) => {
        this.clients = this.clients.filter(c => c.state == 3)
      })
    })
  }
}
export { handleUpgrade, WSServer as default }