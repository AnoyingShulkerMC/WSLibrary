import { WSServer } from "../index.js"

var server = new WSServer()

server.on("connection", (con) => {
  con.on("message", (m) => {
    server.clients.forEach(e => e.send(m))
  })
})
server.server.listen(9010)