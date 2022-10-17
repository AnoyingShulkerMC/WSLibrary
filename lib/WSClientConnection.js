import { EventEmitter } from 'node:events';
import validateUTF8 from './utf8validate.js';
const RESERVED_OP_CODES = [3, 4, 5, 6, 7, 11, 12, 13, 14, 15]
const CONTROL_OP_CODES = [8, 9, 10]
const RESERVED_CLOSE_CODES = [1004, 1005, 1006, 1012, 1013, 1014]

class WSClientConnection extends EventEmitter {
  /**
   * @private
   * @type {number}
   */
  _code = 1006;
  /**
   * @private
   * @type {string}
   */
  _reason = ""
  /**
   * @private
   * @type {boolean}
   */
  _wasClean = false;
  /**
   * @private
   * @type {number}
   */
  _opcode = null
  /**
   * @private
   * @type {Buffer}
   */
  _payload = Buffer.alloc(0)
  /**
   * @private
   * @type {boolean}
   */
  _fragmented = true
  /**
   * Whether the frame loop is finished.
   * @private
   * @type {boolean}
   */
  _frameLoopFinished = true
  /**
   * When to drop the connection when the closing handshake is started
   * @type {number}
   */
  closeTimeout = 2000
  /**
   * The buffer of the stream to be read
   * @private
   * @type {Buffer}
   */
  _packetBuffer = Buffer.alloc(0)
  /**
   * The queue for which to 
   * @private
   */
  _expectBufferQueue = []
  /**
   * 1 indicates OPEN, 2 indicates CLOSING, 3 indicates CLOSED
   * @type {number}
   */
  state = 1
  /**
   * 
   * @param {any} con
   * @param {Object} options
   * @param {number} options.closeTimeout When to close the connection if the closing handshake is delayed beyond closeTimeout.
   */
  constructor(con, { closeTimeout = 2000 } = {}) {
    super()
    this.con = con
    this.closeTimeout = closeTimeout
    this.con.on("data", async (buf) => {
      this._packetBuffer = Buffer.concat([this._packetBuffer, buf])
      this._handleExpectBuffer()
      if (this._frameLoopFinished) this._frameLoop()
    })
    this.con.on("close", () => {
      this.state = 3;
      this.emit("close", { code: this._code, reason: this._reason, wasClean: this._wasClean })
    })
    this.con.on("error", (e) => {
      console.error(e)
    })
  }
  /**
   * @private
   */
  async _frameLoop() {
    this._frameLoopFinished = false
    var message = {
      FIN: null,
      reserved: null,
      opcode: null,
      masked: null,
      length: null,
      maskingKey: null,
      payload: null
    }
    var header2Bytes = await this._expectBuffer(2)
    message.FIN = !!(header2Bytes[0] & 0x80)
    message.reserved = header2Bytes[0] & 0x70
    message.opcode = header2Bytes[0] & 0x0F
    message.masked = !!(header2Bytes[1] & 0x80)
    var length = header2Bytes[1] & 0x7F
    if (length === 126) {
      var bufLength = await this._expectBuffer(2)
      length = bufLength.readUint16BE(0)
    } else if (length === 127) {
      var bufLength = await this._expectBuffer(8)
      length = Number(bufLength.readBigUInt64BE(0))
    }
    message.length = length
    if (message.masked) {
      message.maskingKey = await this._expectBuffer(4)
    }
    var payload = await this._expectBuffer(length)
    message.payload = Buffer.from(payload)
    if (message.masked) {
      for (var i = 0; i < message.payload.length; i++) {
        message.payload[i] = payload[i] ^ message.maskingKey[i % 4]
      }
    }
    this._handleMessage(message)
    if (this._packetBuffer.length !== 0) return this._frameLoop()
    this._frameLoopFinished = true
  }
  /**
   * @private
   */
  _handleExpectBuffer() {
    for (var i = 0; i < this._expectBufferQueue.length; i++) {
      var expect = this._expectBufferQueue[i]
      if (expect[0] > this._packetBuffer.length) break
      expect[1](this._packetBuffer.subarray(0, expect[0]))
      this._packetBuffer = this._packetBuffer.subarray(expect[0])
      this._expectBufferQueue.shift()
    }
  }
  /**
   * @private
   * @param {number} length
   * @returns {Promise<Buffer>}
   */
  _expectBuffer(length) {
    return new Promise((resolve, reject) => {
      if (length <= this._packetBuffer.length) {
        resolve(this._packetBuffer.subarray(0, length))
        return this._packetBuffer = this._packetBuffer.subarray(length)
      }
      this._expectBufferQueue.push([length, resolve])
    })
  }
  /**
   * Closes the connection.
   * @param {number} code The close code
   * @param {string} reason The reason for the close. MUST be 123 bytes or less in length.
   * @fires WSClientConnection#close
   */
  async close(code = null, reason = "") {
    if ((RESERVED_CLOSE_CODES.includes(code) || (code >= 1015 && code <= 2999) || code <= 999) && code !== null) throw new Error("The close code is invalid")
    if (Buffer.from(reason, "utf-8").length > 123) throw new SyntaxError("Close reason is greater than 123 bytes.")
    this.state = 2
    this._close({code, reason})
  }
  /**
   * Sends data to the Websocket
   * @param {string|Buffer} message
   */
  async send(message) {
    if(this.state == 2 || this.state == 3) throw new Error("Websocket is already in CLOSING or CLOSED state")
    if (typeof message !== "string" && !Buffer.isBuffer(message)) throw new TypeError("message must be a string or buffer")
    if (typeof message === "string") {
      return await this._send({
        payload: Buffer.from(message, "utf-8"),
        FIN: true,
        opcode: 1
      })
    }
    return await this._send({
      payload: message,
      FIN: true,
      opcode: 2
    })
  }
  /**
   * @private
   * @param {Object} message
   * @param {Buffer} message.payload
   * @param {number} message.opcode
   * @param {boolean} message.FIN
   * @param {number} message.reserved
   * @returns {Promise}
   */
  _send({ payload, opcode = 0x2, FIN = true, reserved = 0 }) {
    return new Promise((resolve, reject) => {
      if (this.state == 3 || (this.state == 2 && opcode != 8)) return resolve()
      var header;
      if (payload.length <= 125) {
        header = Buffer.alloc(2)
        header[1] = payload.length
      } else if (payload.length <= 0xffff) {
        header = Buffer.alloc(4)
        header[1] = 126
        header.writeUint16BE(payload.length, 2)
      } else {
        header = Buffer.alloc(10)
        header[1] = 127
        header.writeBigUInt64BE(BigInt(payload.length), 2)
      }
      header[0] = (FIN << 7) | (reserved << 4) | opcode
      this.con.write(Buffer.concat([header, payload]), "binary", () => { resolve() })
    })
  }
  /**
   * @private
   */
  async _close({ code = null, reason = "", unclean = false, recieving = false, clean = true }) {
    this._code = code == null? 1005 : code;
    this._reason = reason
    if (unclean) {
      this._code = 1006
      this._wasClean = false;
      this.state = 3;
      return this.con.end()
    }
    if (code == null) {
      await this._send({
        opcode: 8,
        payload: Buffer.alloc(0)
      })
    } else {
      var message = Buffer.alloc(2)
      message.writeUint16BE(code)
      await this._send({
        payload: Buffer.concat([message, Buffer.from(reason, "utf-8")]),
        opcode: 8
      })
    }
    this._wasClean = clean
    this.state = 2
    if (recieving) { this.state = 3; return this.con.end() }
    setTimeout(() => {
      if (this.state !== 3) {
        this._code = 1006
        this._wasClean = false;
        this.state = 3;
        this.con.end()
      }
    }, this.closeTimeout)
  }
  /**
   * @private
   * @param {Object} message The message to parse
   * @param {boolean} message.FIN Whether the message is finished
   * @param {number} message.reserved The reserved bits of the message
   * @param {number} message.opcode The opcode of the message
   * @param {number} message.masked Whether the mssage is masked
   * @param {number} message.length Whether the mssa
   * @param {Buffer} message.maskingKey The masking key of the message
   * @param {Buffer} message.payload The payload of the message
   */
  _handleMessage({ FIN, reserved, opcode, masked, length, maskingKey, payload }) {
    if (this.state == 3 || this.state == 2) return;
    // Sanity checks
    // Clients must mask messages
    if (!masked) return this._close({ unclean: true })
    // Control codes may not be fragmented
    if (CONTROL_OP_CODES.includes(opcode) && !FIN) return this._close({ unclean: true })
    // Opcodes may not be the reserved ones
    if (RESERVED_OP_CODES.includes(opcode)) return this._close({ unclean: true })
    // Reserved bits must be zero
    if (reserved !== 0) return this._close({ unclean: true })
    // Subsequent fragments must be op 0 unless a control code is sent.
    if (!this._fragmented && opcode !== 0 && !CONTROL_OP_CODES.includes(opcode)) return this._close({ unclean: true })
    // Control frames' lengths may not be >125
    if (CONTROL_OP_CODES.includes(opcode) && length > 125) return this._close({ unclean: true })
    // Continuation frames while there is nothing to fragment
    if (opcode === 0 && this._fragmented) return this._close({ unclean: true })

    if (opcode == 0) { // Continuation frame
      this._payload = Buffer.concat([this._payload, payload])
      if (FIN) {
        this._fragmented = true
        if (this._opcode == 1) {
          if (!validateUTF8(this._payload)) return this._close({ unclean: true })
          return this.emit("message", this._payload.toString("utf-8"))
        }
        this.emit("message", this._payload)
        this._payload = Buffer.alloc(0)
      }
    } else if (opcode == 1) { // Text messwage
      this._opcode = 1
      if (FIN) {
        if (!validateUTF8(payload)) return this._close({ unclean: true })
        return this.emit("message", payload.toString("utf-8"))
      }
      this._fragmented = false
      this._payload = Buffer.concat([this._payload, payload])
    } else if (opcode == 2) { // Binary message
      this._opcode = 2
      if (FIN) return this.emit("message", payload)
      this._fragmented = false
      this._payload = Buffer.concat([this._payload, payload])
    } else if (opcode == 8) { // Close frame
      if (this.state == 2) return;
      this.state = 2
      if (length !== 0 && length < 2) {
        return this._close({
          code: 1002,
          reason: "invalid payload",
          recieving: true,
          clean: false
        })
      }
      var code = payload.length >= 2 ? payload.readUint16BE() : null
      if ((RESERVED_CLOSE_CODES.includes(code) || (code >= 1015 && code <= 2999) || code <= 999) && code !== null) {
        return this._close({
          code: 1002,
          reason: "reserved close code",
          recieving: true,
          clean: false
        })
      }
      if (!validateUTF8(payload.subarray(2))) {
        return this._close({
          code: 1007,
          reason: "invalid utf-8",
          recieving: true,
          clean: false
        })
      }
      this._close({
        code,
        reason: payload.subarray(2).toString("utf-8"),
        recieving: true
      })
    } else if (opcode == 9) { // Ping!
      this._send({
        opcode: 10,
        payload
      })
    }
  }
}
export default WSClientConnection
/**
 * Emitted when the server recieves a message by the client.
 * 
 * @event WSClientConnection#message
 * @param {Buffer|string} message The contents of the message
 */
/**
 * Emitted when the client closes
 * 
 * @event WSClientConnection#message
 * @param {number} code The close code of the connection
 * @param {string} reason The reason of the close
 */