import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as url from 'url';
import * as makeDir from 'make-dir';
import * as pkg from './package.json';

const needle = require('needle');
const ProxyAgent = require('proxy-agent');

const os = tl.getVariable('Agent.OS') || "";
const token = tl.getInput('accessToken', true) || "";
const filepath = tl.getInput('filePath', true) || "";
const thresholdType = tl.getInput('thresholdType', true) || "";
const riskThreshold = thresholdType === 'risk' ? (tl.getInput('riskThreshold', true) || "") : "";
const healthScoreThreshold = thresholdType === 'healthScore' ? (tl.getInput('healthScoreThreshold', true) || "") : "";
const host = tl.getInput('host', false) || "";
const generatePdfReport = tl.getBoolInput('generatePdfReport', false);
const triggerKnoxiq = tl.getBoolInput('triggerKnoxiq', false);

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
 * @param url
 * @returns true if valid
 */
function isValidURL(url_input: string): boolean {
    if (!url_input) {
        return false;
    }
    try {
        const validUrl = new url.URL(url_input);
        return !!validUrl.href;
    } catch(err){
        tl.debug(err);
    }

    return false;
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
                tl.error(err);
                return reject(err);
            }
            if (resp.statusCode !== 200) {
                return reject(new Error(`Error code ${resp.statusCode}: ${resp.statusMessage}`));
            }
            tl.debug(`File downloaded: ${dest}`);
            return resolve(resp);
        })
    ).catch(function(err: any) {
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
        throw Error(`Unsupported os ${os}`);
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
 * Creates a report for the file and downloads the PDF (with its password
 * file) to the CLI's default ./reports/{file_id}/ directory. Failures are
 * reported as task warnings rather than failing the whole task, matching
 * the Jenkins plugin's behaviour: a report-download hiccup shouldn't fail
 * an otherwise-passing security check.
 */
async function downloadPdfReport(appknoxPath: string, fileID: string, proxy: string, hasValidProxy: boolean, execOptions: trm.IExecOptions) {
    try {
        const createCmd: trm.ToolRunner = tl.tool(appknoxPath);
        createCmd.arg("reports")
            .arg("create")
            .arg(fileID)
            .argIf(!!host, "--host")
            .argIf(!!host, host)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        const createResult: trm.IExecSyncResult = createCmd.execSync(execOptions);
        const reportID = createResult.stdout.trim();
        if (createResult.code != 0 || !reportID || isNaN(parseInt(reportID, 10))) {
            tl.warning(`Could not create report for PDF download: ${createResult.stderr || "no report ID returned"}`);
            return;
        }
        tl.debug("Report ID: " + reportID);

        const pdfCmd: trm.ToolRunner = tl.tool(appknoxPath);
        pdfCmd.arg("reports")
            .arg("download")
            .arg("pdf")
            .arg(reportID)
            .argIf(!!host, "--host")
            .argIf(!!host, host)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        await pdfCmd.exec(execOptions);
    } catch(err) {
        tl.warning(`PDF report download failed: ${err.message}`);
    }
}

async function upload() {
    tl.debug(`Filepath: ${filepath}`);
    tl.debug(`ThresholdType: ${thresholdType}`);
    tl.debug(`Riskthreshold: ${riskThreshold}`);
    tl.debug(`HealthScoreThreshold: ${healthScoreThreshold}`);
    tl.debug(`TriggerKnoxiq: ${triggerKnoxiq}`);
    tl.debug(`GeneratePdfReport: ${generatePdfReport}`);

    // The access token goes through the environment, never as a CLI argument --
    // ToolRunner echoes the full command line (including every literal
    // argument) into the build log, which would otherwise leak the token in
    // plain text regardless of whether the pipeline variable is marked secret.
    const _execOptions = <trm.IExecOptions>{
        silent: false,
        failOnStdErr: false,
        env: { ...process.env, APPKNOX_ACCESS_TOKEN: token },
    }

    try {
        if (thresholdType !== 'risk' && thresholdType !== 'healthScore') {
            throw new Error(`Invalid thresholdType "${thresholdType}". Must be either "risk" or "healthScore".`);
        }

        if (thresholdType === 'healthScore') {
            const healthScore = parseInt(healthScoreThreshold, 10);
            if (isNaN(healthScore) || healthScore < 0 || healthScore > 100) {
                throw new Error("healthScoreThreshold must be between 0 and 100");
            }
        }

        const proxy = getProxyURL();
        const hasValidProxy = isValidURL(proxy);
        const appknoxPath = await installAppknox(os, proxy);
        const uploadCmd: trm.ToolRunner = tl.tool(appknoxPath);
        uploadCmd.arg("upload")
            .arg(filepath)
            .argIf(!!host, "--host")
            .argIf(!!host, host)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy)
            .argIf(triggerKnoxiq, "--knoxiq");

        const result: trm.IExecSyncResult = uploadCmd.execSync(_execOptions);
        if (result.code != 0) {
            let errmsg = (result.stderr || "Upload Failed").split('\n');
            throw new Error(errmsg[errmsg.length-1]);
        }
        const fileID: string = result.stdout.trim();
        tl.debug("File ID: " + fileID);
        const checkCmd: trm.ToolRunner = tl.tool(appknoxPath);
        checkCmd.arg("cicheck")
            .arg(fileID);
        
        if (thresholdType === 'healthScore') {
            checkCmd.arg("--health-score-threshold")
                .arg(healthScoreThreshold);
        } else {
            checkCmd.arg("--risk-threshold")
                .arg(riskThreshold);
        }

        checkCmd.argIf(!!host, "--host")
            .argIf(!!host, host)
            .argIf(hasValidProxy, "--proxy")
            .argIf(hasValidProxy, proxy);

        let ciCheckError: any = null;
        try {
            await checkCmd.exec(_execOptions);
        } catch(err) {
            ciCheckError = err;
        }

        if (generatePdfReport) {
            await downloadPdfReport(appknoxPath, fileID, proxy, hasValidProxy, _execOptions);
        }

        if (ciCheckError) {
            throw ciCheckError;
        }

    } catch(err) {
        tl.setResult(tl.TaskResult.Failed, err.message);
    }
}

upload();
