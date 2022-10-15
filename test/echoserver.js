import { WSServer } from "../index.js"
var server = new WSServer()
const port = 9010
server.on("connection", (con) => {
  con.on("message", (m) => {
    con.send(m)
  })
  con.on("close", console.log)
})
server.server.listen(port, () => console.log("listening on " + port))