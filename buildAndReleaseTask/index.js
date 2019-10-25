"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var tl = require("azure-pipelines-task-lib/task");
var filepath = tl.getInput("filepath", true) || "";
var token = tl.getInput("accessToken", true) || "";
var riskThreshold = tl.getInput("riskThreshold", false);
var onError = function (errMsg, code) {
    tl.error(errMsg);
    tl.setResult(tl.TaskResult.Failed, errMsg);
};
tl.setTaskVariable("APPKNOX_ACCESS_TOKEN", token, true);
var appknoxPath = tl.which("appknox");
if (!appknoxPath) {
    onError("appknox is not found in the path", 1);
}
var appknox1 = tl.tool("appknox");
appknox1.arg("upload");
appknox1.arg(filepath);
appknox1.exec();
appknox1.on("stdout", function (data) {
    var fileId = data.toString();
    console.log(fileId);
    console.log(riskThreshold);
    if (riskThreshold) {
        var appknox2 = tl.tool("appknox");
        appknox2.arg("cicheck");
        appknox2.arg(fileId);
        appknox2.arg("--risk-threshold");
        appknox2.arg(riskThreshold);
        appknox2.exec();
    }
});
