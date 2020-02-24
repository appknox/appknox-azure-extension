import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');
const pkg = require('./package.json');
const download = require('download');

const filepath = tl.getInput("filePath", true) || "";
const token = tl.getInput("accessToken", true) || "";
const riskThreshold: string = tl.getInput("riskThreshold", true) || "low";
const os = tl.getVariable("Agent.OS"); // https://docs.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml#agent-variables
const winBinary = "appknox-Windows-x86_64.exe";
const darwinBinary = "appknox-Darwin-x86_64";
const linuxBinary = "appknox-Linux-x86_64";

const binaryVersion = pkg.binary;

function downloadPath(binary: string) {
    return `https://github.com/appknox/appknox-go/releases/download/${binaryVersion}/${binary}`;
}

function getBinaryName() {
    if(os == "Windows_NT") {
        return winBinary;
    }
    if(os == "Darwin") {
        return darwinBinary;
    }
    if(os == "Linux") {
        return linuxBinary;
    }
    throw Error("unsupported os " + os);
}

async function downloadBinary() {
    const binName = getBinaryName()
    const dPath = downloadPath(binName);
    await download(dPath, path.join(__dirname, "binaries"));
}

function getAppknoxPath(): string {
    if(os == "Windows_NT") {
        return "C:\\Program Files\\appknox.exe";
    }
    if(os == "Darwin" || os == "Linux") {
        return "/usr/local/bin/appknox";
    }
    throw Error("unsupported os " + os);
}

async function copyAppknox() {
    const appknoxPath = getAppknoxPath();
    const binPath = path.join(__dirname, 'binaries');
    const winBin = path.join(binPath, winBinary)
    const darwinBin = path.join(binPath, darwinBinary);
    const linuxBin = path.join(binPath, linuxBinary);
    if(fs.existsSync(appknoxPath)) {
        return;
    }
    await downloadBinary();
    if(os == "Windows_NT") {
        return tl.cp(winBin, appknoxPath);
    }
    if(os == "Darwin") {
        tl.cp(darwinBin, appknoxPath, "-f");
        return fs.chmodSync(appknoxPath, "755");
    }
    if(os == "Linux") {
        tl.cp(linuxBin, appknoxPath, "-f");
        return fs.chmodSync(appknoxPath, "755");
    }
    throw Error("unsupported os " + os);
}

async function upload(filepath: string, riskThreshold: string) {
    await copyAppknox();
    const appknoxPath = getAppknoxPath();
    try {
        const appknoxUploader = tl.tool(appknoxPath);
        const xargs = tl.tool('xargs')
        appknoxUploader.arg("upload")
                        .arg(filepath)
                        .arg("--access-token")
                        .arg(token);
        xargs.arg(appknoxPath)
                        .arg("cicheck")
                        .arg("--risk-threshold")
                        .arg(riskThreshold)
                        .arg("--access-token")
                        .arg(token);
        appknoxUploader.pipeExecOutputToTool(xargs);
        const ret = await appknoxUploader.exec();
        return ret;
    }
    catch(err){
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload(filepath, riskThreshold)
