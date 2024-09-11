import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as url from 'url';
import * as makeDir from 'make-dir';
const pkg = require('./package.json');
// import * as pkg from './package.json';

const needle = require('needle');
const ProxyAgent = require('proxy-agent');

const os = tl.getVariable('Agent.OS') || "";
const token = tl.getInput('accessToken', true) || "";
const filepath = tl.getInput('filePath', true) || "";
const riskThreshold = tl.getInput('riskThreshold') || "low";
const region = tl.getInput('region', true) || "Global";  // Get region input

// Define valid tokens for each region
const saudiToken = "03dbfbdd51db9e9768cf63014b861b820c13f481";
const globalToken = "245d2ea50185c7660e9953b332f22950311b7fb9";

// Map region to API URL
let apiUrl = 'https://api.appknox.com/'; // Default to Global
if (region === 'Saudi') {
    apiUrl = 'https://sa.secure.appknox.com/';
}

// Check if the accessToken matches the selected region
if (region === 'Saudi' && token !== saudiToken) {
    tl.setResult(tl.TaskResult.Failed, "Region is set to 'Saudi', but the access token does not match the Saudi token.");
    process.exit(1);
} else if (region === 'Global' && token !== globalToken) {
    tl.setResult(tl.TaskResult.Failed, "Region is set to 'Global', but the access token does not match the Global token.");
    process.exit(1);
}

interface AppknoxBinaryConfig {
    name: string,
    path: string,
    copyToBin(src: string, perm: string): void;
}

type OSAppknoxBinaryMap = Record<string, AppknoxBinaryConfig>;

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
        path: path.join(__dirname, "appknox.exe"),
        copyToBin(src: string, perm: string) {
            return tl.cp(src, this.path, "-f");
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
};

/**
 * Gets proxy URL set via ENV, fallbacks to agent proxy
 * @returns proxy URL
 */
function getProxyURL(): string {
    const envProxy = (
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy
    );

    if (envProxy && !isValidURL(envProxy)) {
        throw Error(`Invalid proxy URL in environment: ${envProxy}`);
    }

    let agentProxy = "";
    const agentProxyConfig = tl.getHttpProxyConfiguration();
    if (agentProxyConfig != null && agentProxyConfig.proxyUrl != "") {
        const _u = url.parse(agentProxyConfig.proxyUrl);
        const user = agentProxyConfig.proxyUsername;
        const pswd = agentProxyConfig.proxyPassword;

        const u = new url.URL(`${_u.protocol}//${(user || pswd) ? `${user}:${pswd}@` : ''}${_u.host}${_u.path}`);
        agentProxy = u.href;
    }

    const proxy = envProxy || agentProxy;
    tl.debug(`Using proxy: ${proxy}`);
    return proxy;
}

/**
 * Determines whether the URL is valid
 * @param url_input
 * @returns true if valid
 */
function isValidURL(url_input: string): boolean {
    if (!url_input) {
        return false;
    }
    try {
        const validUrl = new url.URL(url_input);
        return !!validUrl.href;
    } catch (err) {
        tl.debug(err);
    }

    return false;
}

/**
 * Gets appknox binary download URL
 * @param os
 * @returns URL
 */
function getAppknoxDownloadURL(os: string): string {
    if (!(os in supportedOS)) {
        throw Error(`Unsupported OS ${os}`);
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
        needle.get(url, opts, function (err: any, resp: http.IncomingMessage, body: string) {
            if (err) {
                tl.error(err);
                return reject(err);
            }
            if (resp.statusCode !== 200) {
                return reject(new Error(`Error code ${resp.statusCode}: ${resp.statusMessage}`));
            }
            tl.debug(`File downloaded: ${dest}`);
            return resolve(resp);
        })
    ).catch(function (err: any) {
        tl.debug(`Error downloading file: ${err}`);
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
        throw Error(`Unsupported OS ${os}`);
    }
    const url = getAppknoxDownloadURL(os);

    const tmpDir = 'binaries';
    const binpath = await makeDir(tmpDir);
    const tmpFile = path.join(binpath, supportedOS[os].name);

    tl.debug(`Downloading appknox binary from ${url} to ${tmpFile}`);
    await downloadFile(url, proxy, tmpFile);

    if (!fs.existsSync(tmpFile)) {
        throw Error("Could not download appknox binary");
    }

    tl.debug("Download finished");

    supportedOS[os].copyToBin(tmpFile, "755");
    tl.debug(`Appknox installation completed: ${supportedOS[os].path}`);

    return supportedOS[os].path;
}

/**
 * Upload and perform security check with Appknox
 * @param filepath
 * @param riskThreshold
 */
async function upload(filepath: string, riskThreshold: string) {
    tl.debug(`Filepath: ${filepath}`);
    tl.debug(`Risk threshold: ${riskThreshold}`);

    const _execOptions = <trm.IExecOptions>{
        silent: false,
        failOnStdErr: false,
    };

    try {
        const proxy = getProxyURL();
        const hasValidProxy = isValidURL(proxy);
        const appknoxPath = await installAppknox(os, proxy);
        const uploadCmd: trm.ToolRunner = tl.tool(appknoxPath);
        uploadCmd.arg("upload")
            .arg(filepath)
            .arg("--access-token")
            .arg(token)
            .arg("--api-url")  // Adding the apiUrl argument
            .arg(apiUrl)       // Using the correct API URL based on region
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        const result: trm.IExecSyncResult = uploadCmd.execSync(_execOptions);
        if (result.code != 0) {
            let errmsg = (result.stderr || "Upload Failed").split('\n');
            throw new Error(errmsg[errmsg.length - 1]);
        }
        const fileID: string = result.stdout.trim();
        tl.debug("File ID: " + fileID);
        const checkCmd: trm.ToolRunner = tl.tool(appknoxPath);
        checkCmd.arg("cicheck")
            .arg(fileID)
            .arg("--risk-threshold")
            .arg(riskThreshold)
            .arg("--access-token")
            .arg(token)
            .arg("--api-url")  // Adding the apiUrl argument
            .arg(apiUrl)       // Using the correct API URL based on region
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);
        return await checkCmd.exec(_execOptions);

    } catch (err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload(filepath, riskThreshold);
