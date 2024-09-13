"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var tl = require("azure-pipelines-task-lib/task");
var path = require("path");
var fs = require("fs");
var url = require("url");
var makeDir = require('make-dir');
var pkg = require('./package.json');
var needle = require('needle');
var ProxyAgent = require('proxy-agent');
var os = tl.getVariable('Agent.OS') || "";
var token = tl.getInput('accessToken', true) || "";
var filepath = tl.getInput('filePath', true) || "";
var riskThreshold = tl.getInput('riskThreshold') || "low";
var region = tl.getInput('region', true) || "Global"; // Get region input
console.log("Using Region: ".concat(region));
var supportedOS = {
    'Linux': {
        name: "appknox-Linux-x86_64", // Updated binary name
        path: "/usr/local/bin/appknox",
        copyToBin: function (src, perm) {
            tl.cp(src, this.path, "-f");
            return fs.chmodSync(this.path, perm);
        }
    },
    'Windows_NT': {
        name: "appknox-Windows-x86_64.exe", // Updated binary name
        path: path.join(__dirname, "appknox.exe"),
        copyToBin: function (src, perm) {
            return tl.cp(src, this.path, "-f");
        }
    },
    'Darwin': {
        name: "appknox-Darwin-x86_64", // Updated binary name
        path: "/usr/local/bin/appknox",
        copyToBin: function (src, perm) {
            tl.cp(src, this.path, "-f");
            return fs.chmodSync(this.path, perm);
        }
    },
};
/**
 * Gets proxy url set via ENV, fallbacks to agent proxy
 * @returns proxy url
 */
function getProxyURL() {
    var envProxy = (process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy);
    if (envProxy && !isValidURL(envProxy)) {
        throw Error("Invalid proxy url in environment: ".concat(envProxy));
    }
    var agentProxy = "";
    var agentProxyConfig = tl.getHttpProxyConfiguration();
    if (agentProxyConfig != null && agentProxyConfig.proxyUrl != "") {
        var _u = url.parse(agentProxyConfig.proxyUrl);
        var user = agentProxyConfig.proxyUsername;
        var pswd = agentProxyConfig.proxyPassword;
        var u = new url.URL("".concat(_u.protocol, "//").concat((user || pswd) ? "".concat(user, ":").concat(pswd, "@") : '').concat(_u.host).concat(_u.path));
        agentProxy = u.href;
    }
    var proxy = envProxy || agentProxy;
    tl.debug("Using proxy: ".concat(proxy));
    return proxy;
}
/**
 * Determines whether the URL is valid
 * @param url
 * @returns true if valid
 */
function isValidURL(url_input) {
    if (!url_input) {
        return false;
    }
    try {
        var validUrl = new url.URL(url_input);
        return !!validUrl.href;
    }
    catch (err) {
        tl.debug(err);
    }
    return false;
}
/**
 * Gets appknox binary download url from your custom fork
 * @param os
 * @returns url
 */
function getAppknoxDownloadURL(os) {
    if (!(os in supportedOS)) {
        throw Error("Unsupported os ".concat(os));
    }
    var binaryVersion = pkg.binary;
    var binaryName = supportedOS[os].name;
    return "https://github.com/yashviagrawal/appknox-go/releases/download/v1.0.0/".concat(binaryName); // Update URL to your repo
}
/**
 * Downloads file to the specified destination
 * @param url
 * @param proxy
 * @param dest file
 */
function downloadFile(url, proxy, dest) {
    return __awaiter(this, void 0, void 0, function () {
        var opts;
        return __generator(this, function (_a) {
            opts = {
                agent: proxy ? new ProxyAgent(proxy) : undefined,
                follow: 5,
                output: dest,
            };
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    return needle.get(url, opts, function (err, resp, body) {
                        if (err) {
                            tl.error(err);
                            return reject(err);
                        }
                        if (resp.statusCode !== 200) {
                            return reject(new Error("Error code ".concat(resp.statusCode, ": ").concat(resp.statusMessage)));
                        }
                        tl.debug("File downloaded: ".concat(dest));
                        return resolve(resp);
                    });
                }).catch(function (err) {
                    tl.debug("Error downloading file: ".concat(err));
                    throw err;
                })];
        });
    });
}
/**
 * Download & install appknox binary
 * @param os
 * @param proxy
 * @returns appknox binary path
 */
function installAppknox(os, proxy) {
    return __awaiter(this, void 0, void 0, function () {
        var url, tmpDir, binpath, tmpFile;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(os in supportedOS)) {
                        throw Error("Unsupported os ".concat(os));
                    }
                    url = getAppknoxDownloadURL(os);
                    tmpDir = 'binaries';
                    return [4 /*yield*/, makeDir(tmpDir)];
                case 1:
                    binpath = _a.sent();
                    tmpFile = path.join(binpath, supportedOS[os].name);
                    tl.debug("Downloading appknox binary from ".concat(url, " to ").concat(tmpFile));
                    return [4 /*yield*/, downloadFile(url, proxy, tmpFile)];
                case 2:
                    _a.sent();
                    if (!fs.existsSync(tmpFile)) {
                        throw Error("Could not download appknox binary");
                    }
                    tl.debug("Download finished");
                    supportedOS[os].copyToBin(tmpFile, "755");
                    tl.debug("Appknox installation completed: ".concat(supportedOS[os].path));
                    return [2 /*return*/, supportedOS[os].path];
            }
        });
    });
}
function upload(filepath, riskThreshold) {
    return __awaiter(this, void 0, void 0, function () {
        var _execOptions, proxy, hasValidProxy, appknoxPath, uploadCmd, result, errmsg, fileID, checkCmd, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    tl.debug("Filepath: ".concat(filepath));
                    tl.debug("Riskthreshold: ".concat(riskThreshold));
                    _execOptions = {
                        silent: false,
                        failOnStdErr: false,
                    };
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    proxy = getProxyURL();
                    hasValidProxy = isValidURL(proxy);
                    return [4 /*yield*/, installAppknox(os, proxy)];
                case 2:
                    appknoxPath = _a.sent();
                    uploadCmd = tl.tool(appknoxPath);
                    uploadCmd.arg("upload")
                        .arg(filepath)
                        .arg("--access-token")
                        .arg(token)
                        .arg("--region") // Use --region flag instead of host
                        .arg(region) // Pass the region directly
                        .argIf(hasValidProxy, "--proxy")
                        .argIf(hasValidProxy, proxy);
                    result = uploadCmd.execSync(_execOptions);
                    if (result.code != 0) {
                        errmsg = (result.stderr || "Upload Failed").split('\n');
                        throw new Error(errmsg[errmsg.length - 1]);
                    }
                    fileID = result.stdout.trim();
                    tl.debug("File ID: " + fileID);
                    checkCmd = tl.tool(appknoxPath);
                    checkCmd.arg("cicheck")
                        .arg(fileID)
                        .arg("--risk-threshold")
                        .arg(riskThreshold)
                        .arg("--access-token")
                        .arg(token)
                        .arg("--region") // Use --region flag for API region
                        .arg(region) // Pass the region directly
                        .argIf(hasValidProxy, "--proxy")
                        .argIf(hasValidProxy, proxy);
                    return [4 /*yield*/, checkCmd.exec(_execOptions)];
                case 3: return [2 /*return*/, _a.sent()];
                case 4:
                    err_1 = _a.sent();
                    tl.setResult(tl.TaskResult.Failed, err_1.message);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
upload(filepath, riskThreshold);
