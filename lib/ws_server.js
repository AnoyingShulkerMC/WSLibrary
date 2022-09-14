import WSClientConnection from "./WSClientConnection.js"
import crypto from "node:crypto"
function handleUpgrade(req, socket) {
  console.log("handlingUpgrade")
  return new Promise((resolve, reject) => {
    if (req.headers.upgrade.toLowerCase() !== "websocket" ||
      req.headers.upgrade === undefined ||
      !req.headers["sec-websocket-key"] ||
      req.headers["sec-websocket-version"] !== "13" ||
      !req.headers) {
      socket.write(`HTTP/1.1 400 Bad Request\r\n\r\n`)
      socket.end()
      return reject(new Error("Websocket Handshake Failed"))
    }
    var hash = crypto.createHash("sha1")
    hash.update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n` +
      `Upgrade: WebSocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-Websocket-Accept: ${hash.digest("base64")}\r\n\r\n`, () => {
        resolve(new WSClientConnection(socket))
      })
  })
}
export default handleUpgrade