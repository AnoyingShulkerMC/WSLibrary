import WebSocket from "../index.js"
import { once } from "node:events"
const caseCountCon = new WebSocket("ws://localhost:9001/getCaseCount")
const caseCount = parseInt(await once(caseCountCon, "message"))
console.log(caseCount)
for (var i = 1; i < caseCount + 1; i++) {
  console.log(i, caseCount + 1)
  try {
    var cli = new WebSocket("ws://localhost:9001/runCase?case=" + i + "&agent=node")
    cli.on("open", () => { cli.on("message", s => { cli.send(s) }) })
    cli.on("close", console.log)
    var close = await once(cli, "close")
  } catch (e) {
    console.log(e.stack, "ws://localhost:9001/runCase?case=" + i + "&agent=node")
  }
}
console.log("done")
const updeateReportCon = new WebSocket("ws://localhost:9001/updateReports?agent=node")