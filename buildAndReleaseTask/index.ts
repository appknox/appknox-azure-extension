import tl = require('azure-pipelines-task-lib/task');
import tr = require('azure-pipelines-task-lib/toolrunner');

let filepath = tl.getInput("filepath", true) || "";
let token = tl.getInput("accessToken", true) || "";
let riskThreshold = tl.getInput("riskThreshold", false);

let onError = function (errMsg: string, code: number) {
    tl.error(errMsg);
    tl.setResult(tl.TaskResult.Failed, errMsg);
  }

tl.setTaskVariable("APPKNOX_ACCESS_TOKEN", token, true)

let appknoxPath = tl.which("appknox")
if (!appknoxPath) {
    onError("appknox is not found in the path", 1);
  }
let appknox1 = tl.tool("appknox");

appknox1.arg("upload");
appknox1.arg(filepath);
appknox1.exec()

appknox1.on("stdout", function (data: Buffer) {
    let fileId = data.toString();
    console.log(fileId)
    console.log(riskThreshold)
    if (riskThreshold) {
      let appknox2 = tl.tool("appknox");
      appknox2.arg("cicheck");
      appknox2.arg(fileId);
      appknox2.arg("--risk-threshold");
      appknox2.arg(riskThreshold);
      appknox2.exec()
    }
  });
