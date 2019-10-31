import tl = require('azure-pipelines-task-lib/task');
import tr = require('azure-pipelines-task-lib/toolrunner');
import path = require('path');
import fs = require('fs');

const filepath = tl.getInput("filepath", true) || "";
const token = tl.getInput("accessToken", true) || "";
const riskThreshold = tl.getInput("riskThreshold", false);

const appknoxCLIPath = path.join(__dirname, 'appknox')

const appknoxPath1 = tl.which("appknox");
if (!appknoxPath1) {
    fs.chmodSync(appknoxCLIPath, "755");
    tl.cp(appknoxCLIPath, "/usr/local/bin/");
}

const appknoxPath2 = tl.which("appknox");


async function upload(filepath: string, riskThreshold?: string) {
    try {
        const appknoxUploader = tl.tool(appknoxPath2);
        const xargs = tl.tool('xargs')
        appknoxUploader.arg("upload")
                        .arg(filepath)
                        .arg("--access-token")
                        .arg(token);
        if (riskThreshold) {
            xargs.arg(appknoxPath2)
                  .arg("cicheck")
                  .arg("--risk-threshold")
                  .arg(riskThreshold)
                  .arg("--access-token")
                  .arg(token);
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
