import tl = require('azure-pipelines-task-lib/task');
import tr = require('azure-pipelines-task-lib/toolrunner');
import path = require('path');

const filepath = tl.getInput("filepath", true) || "";
const token = tl.getInput("accessToken", true) || "";
const riskThreshold = tl.getInput("riskThreshold", false);

tl.setTaskVariable("APPKNOX_ACCESS_TOKEN", token, true)
const appknoxCLIPath = path.join(__dirname, 'appknox')

async function upload(filepath: string, riskThreshold?: string) {
    try {
        const appknoxUploader = tl.tool(appknoxCLIPath);
        const appknoxChecker = tl.tool(appknoxCLIPath);
        const xargs = tl.tool('xargs')
        appknoxUploader.arg("upload")
                        .arg(filepath);
        if (riskThreshold) {
            xargs.arg(appknoxCLIPath).arg("cicheck").arg("--risk-threshold").arg(riskThreshold)
            appknoxUploader.pipeExecOutputToTool(xargs);
        }
        const ret = await appknoxUploader.exec();
        return ret;
    }
    catch(err){
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload(filepath, riskThreshold)
