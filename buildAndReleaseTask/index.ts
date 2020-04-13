import tl = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');
import download = require('download');
import pkg = require('./package.json');

const ProxyAgent = require('proxy-agent');
const isUrlHttp = require('is-url-http');

const os = tl.getVariable('Agent.OS') || "";
const token = tl.getInput('accessToken', true) || "";
const filepath = tl.getInput('filePath', true) || "";
const riskThreshold = tl.getInput('riskThreshold', true) || "low";


interface AppknoxBinaryConfig {
    name: string,
    path: string,
    copyToBin(src: string, perm: string): void;

}
type OSAppknoxBinaryMap = Record<string, AppknoxBinaryConfig>

const supportedOS: OSAppknoxBinaryMap = {
    'Linux': {
        name: "appknox-Linux-x86_64",
        path: "/usr/local/bin/appknox",
        copyToBin(src: string, perm: string) {
            tl.cp(src, this.path, "-f");
            return fs.chmodSync(this.path, perm);
        }
    },
    'Windows_NT': {
        name: "appknox-Windows-x86_64.exe",
        path: "C:\\Program Files\\appknox.exe",
        copyToBin(src: string, perm: string) {
            return tl.cp(src, this.path);
        }
    },
    'Darwin': {
        name: "appknox-Darwin-x86_64",
        path: "/usr/local/bin/appknox",
        copyToBin(src: string, perm: string) {
            tl.cp(src, this.path, "-f");
            return fs.chmodSync(this.path, perm);
        }
    },
}


/**
 * Gets proxy url set via ENV, fallbacks to agent proxy
 * @returns proxy url
 */
function getProxyURL(): string {
    const envProxy = (
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy
    );

    if (envProxy && !isValidURL(envProxy)) {
        throw Error(`Invalid proxy url in environment: ${envProxy}`);
    }

    const agentProxyConfig = tl.getHttpProxyConfiguration();
    const agentProxy = (agentProxyConfig != null) ? agentProxyConfig.proxyUrl : "";

    return envProxy || agentProxy;
}


/**
 * Determines whether the URL is valid
 * @param url
 * @returns true if valid
 */
function isValidURL(url: string): boolean {
    if (!url) {
        return false;
    }
    return isUrlHttp(url);
}

/**
 * Gets appknox binary download url
 * @param os
 * @returns url
 */
function getAppknoxDownloadURL(os: string): string {
    if (!(os in supportedOS)) {
        throw Error(`Unsupported os ${os}`);
    }
    const binaryVersion = pkg.binary;
    const binaryName = supportedOS[os].name;
    return `https://github.com/appknox/appknox-go/releases/download/${binaryVersion}/${binaryName}`;
}

/**
 * Download & install appknox binary
 * @param os
 * @param proxy
 * @returns appknox binary path
 */
async function installAppknox(os: string, proxy: string): Promise<string> {
    if (!(os in supportedOS)) {
        throw Error(`Unsupported os ${os}`);
    }
    const tmpDir = path.join(__dirname, 'binaries');
    const tmpFile = path.join(tmpDir, supportedOS[os].name);

    const url = getAppknoxDownloadURL(os);
    const opts = {
        agent: proxy ? new ProxyAgent(proxy) : undefined
    };
    await download(url, tmpDir, opts);

    supportedOS[os].copyToBin(tmpFile, "755");
    return supportedOS[os].path;
}


async function upload(filepath: string, riskThreshold: string) {
    tl.debug(`Filepath: ${filepath}`);
    tl.debug(`Riskthreshold: ${riskThreshold}`);

    const proxy = getProxyURL();
    const hasValidProxy = isValidURL(proxy);

    const appknoxPath = await installAppknox(os, proxy);

    try {
        const appknox = tl.tool(appknoxPath);
        const xargs = tl.tool('xargs')

        appknox.arg("upload")
            .arg(filepath)
            .arg("--access-token")
            .arg(token)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        xargs.arg(appknoxPath)
            .arg("cicheck")
            .arg("--risk-threshold")
            .arg(riskThreshold)
            .arg("--access-token")
            .arg(token)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        appknox.pipeExecOutputToTool(xargs);

        return await appknox.exec();
    } catch(err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload(filepath, riskThreshold)
