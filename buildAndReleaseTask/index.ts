import tl = require('azure-pipelines-task-lib/task');
import trm = require('azure-pipelines-task-lib/toolrunner');
import path = require('path');
import fs = require('fs');
import http = require('http');
import pkg = require('./package.json');

const needle = require('needle');
const ProxyAgent = require('proxy-agent');
const isUrlHttp = require('is-url-http');

const os = tl.getVariable('Agent.OS') || "";
const token = tl.getInput('accessToken', true) || "";
const filepath = tl.getInput('filePath', true) || "";
const riskThreshold = tl.getInput('riskThreshold') || "low";


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
 * Downloads file to the specified destination
 * @param url
 * @param proxy
 * @param dest file
 */
async function downloadFile(url: string, proxy: string, dest: string): Promise<any> {
    const opts = {
        agent: proxy ? new ProxyAgent(proxy) : undefined,
        follow: 5,
        output: dest,
    };
    return new Promise((resolve: (value?: unknown) => void, reject: (reason?: any) => void) =>
        needle.get(url, opts, function(err: any, resp: http.IncomingMessage, body: string) {
            if (err) {
                return reject(err);
            }
            if (resp.statusCode !== 200) {
                return reject(new Error(`Error code ${resp.statusCode}: ${resp.statusMessage}`));
            }
            return resolve(resp);
        })
    ).catch(function(err: any) {
        throw err;
    });
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
    const url = getAppknoxDownloadURL(os);
    const tmpFile = path.join(__dirname, 'tmp', supportedOS[os].name);

    tl.debug("Downloading appknox binary from " + url);
    await downloadFile(url, proxy, tmpFile);
    tl.debug("Download completed");

    supportedOS[os].copyToBin(tmpFile, "755");
    return supportedOS[os].path;
}


async function upload(filepath: string, riskThreshold: string) {
    tl.debug(`Filepath: ${filepath}`);
    tl.debug(`Riskthreshold: ${riskThreshold}`);

    const _execOptions = <trm.IExecOptions>{
        silent: false,
        failOnStdErr: true,
    }

    try {
        const proxy = getProxyURL();
        const hasValidProxy = isValidURL(proxy);
        const appknoxPath = await installAppknox(os, proxy);

        const uploadCmd: trm.ToolRunner = tl.tool(appknoxPath);
        uploadCmd.arg("upload")
            .arg(filepath)
            .arg("--access-token")
            .arg(token)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        let result: trm.IExecSyncResult = uploadCmd.execSync(_execOptions);
        if (result.code == 1) {
            throw result.error;
        }
        const fileID: string = result.stdout.trim();

        const checkCmd: trm.ToolRunner = tl.tool(appknoxPath);
        checkCmd.arg("cicheck")
            .arg(fileID)
            .arg("--risk-threshold")
            .arg(riskThreshold)
            .arg("--access-token")
            .arg(token)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);
        return await checkCmd.exec(_execOptions);

    } catch(err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload(filepath, riskThreshold)
