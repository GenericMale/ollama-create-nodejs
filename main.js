#!/usr/bin/env node

/*
 * Licensed under the EUPL-1.2 or later.
 * You may obtain a copy of the licence at https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12
 */

const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const stream = require("stream/promises");
const {Readable} = require("stream");
const util = require("util");

const MODELS_DIR =
    process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");

const FILE_TYPES = [
    "adapter",
    "embed",
    "license",
    "messages",
    "model",
    "params",
    "projector",
    "prompt",
    "system",
    "template",
];
const MODEL_REGEX =
    /^(?:(?<repository>[\w.-]+)\/)?(?<model>[\w.-]+)(?::(?<version>[\w.-]+))?$/;

const options = {
    from: {
        type: "string",
        short: "f",
    },
    name: {
        type: "string",
        short: "n",
    },
    show: {
        type: "boolean",
        default: false,
        short: "s",
    },
    registry: {
        type: "string",
        default: "registry.ollama.ai",
        short: "r",
    },
    dir: {
        type: "string",
        default: MODELS_DIR,
        short: "d",
    },
};
FILE_TYPES.forEach((t) => (options[t] = {type: "string"}));

class ModelFile {
    constructor(filePath) {
        this.path = path.resolve(filePath);
    }

    async size() {
        const stats = await fs.stat(this.path);
        return stats.size;
    }

    digest() {
        console.log(`Calculating Digest for ${this.path}...`);
        return new Promise((resolve, reject) => {
            this._file().then((file) => {
                const hash = crypto.createHash("sha256");
                const stream = file.createReadStream();
                stream.on("data", (d) => hash.update(d));
                stream.on("error", reject);
                stream.on("end", () => resolve("sha256:" + hash.digest("hex")));
            }, reject);
        });
    }

    async _file() {
        if (!this.fileHandle) this.fileHandle = await fs.open(this.path, "r");
        return this.fileHandle;
    }

    async _read(bytes) {
        const file = await this._file();
        const {buffer} = await file.read(
            Buffer.alloc(bytes),
            0,
            bytes,
            this.offset
        );
        this.offset += bytes;
        return this.le ? buffer.reverse() : buffer;
    }

    async _readType(type) {
        if (type === 0) return (await this._read(1)).readUInt8();
        if (type === 1) return (await this._read(1)).readInt8();
        if (type === 2) return (await this._read(2)).readUInt16BE();
        if (type === 3) return (await this._read(2)).readInt16BE();
        if (type === 4) return (await this._read(4)).readUInt32BE();
        if (type === 5) return (await this._read(4)).readInt32BE();
        if (type === 6) return (await this._read(4)).readFloatBE();
        if (type === 7) return (await this._read(1)).readInt8() !== 0;
        if (type === 8) {
            const length = await this._readLength();
            return (await this._read(length)).reverse().toString();
        }
        if (type === 9) {
            const arrayType = await this._readType(4);
            const length = await this._readLength();
            const array = [];
            for (let i = 0; i < length; i++) {
                array.push(await this._readType(arrayType));
            }
            return array;
        }
        if (type === 10) return Number((await this._read(8)).readBigUInt64BE());
        if (type === 11) return Number((await this._read(8)).readBigInt64BE());
        if (type === 12) return (await this._read(8)).readDoubleBE();

        throw new Error(`not a valid gguf file: unsupported type ${type}`);
    }

    _readLength() {
        return this.version === 1 ? this._readType(4) : this._readType(10);
    }

    async readMetadata() {
        this.offset = 0;
        this.le = false;

        const magic = (await this._read(4)).toString();
        if (magic !== "GGUF")
            throw new Error(
                "not a valid gguf file: not starting with GGUF magic number"
            );

        const metadata = {};

        const version = await this._read(4);
        this.version = version.readUInt32LE();
        if (this.version <= 3 && this.version >= 1) {
            this.le = true;
        } else {
            this.version = version.readUInt32BE();
            if (this.version > 3 || this.version < 1)
                throw new Error(`not a valid gguf file: unsupported version`);
        }

        metadata.version = this.version;
        metadata.tensor_count = await this._readLength();
        metadata.kv_count = await this._readLength();

        for (let i = 0; i < metadata.kv_count; i++) {
            const key = await this._readType(8);
            const type = await this._readType(4);
            const value = await this._readType(type);

            let prop = metadata;
            key.split(".").forEach((k, i, keys) => {
                if (i === keys.length - 1) {
                    prop[k] = value;
                } else if (prop[k] === undefined) {
                    prop[k] = {}
                } else if (!(prop[k] instanceof Object)) {
                    prop[k] = {value: prop[k]}
                }
                prop = prop[k];
            });
        }

        return metadata;
    }
}

function getModelName(metadata) {
    const parts = [metadata.basename || metadata.name];
    if (metadata.size_label) parts.push(metadata.size_label);
    if (metadata.finetune) parts.push(metadata.finetune);
    if (metadata.version) parts.push(metadata.version);
    return parts.join("-").replaceAll(" ", "-");
}

async function downloadManifest(baseUrl, version) {
    console.log(`Downloading ${baseUrl}/manifests/${version}...`);
    const response = await fetch(`${baseUrl}/manifests/${version}`);
    const manifest = await response.json();
    if (manifest.errors) {
        const msg = manifest.errors[0].message || manifest.errors[0].code || "";
        throw new Error(`failed to download manifest: ${msg}`);
    }
    return manifest;
}

async function writeManifest(dir, manifest) {
    const file = path.join(dir, "latest");

    console.log(`Writing ${file}...`);
    await fs.mkdir(dir, {recursive: true});
    await fs.rm(file, {force: true});
    await fs.writeFile(file, JSON.stringify(manifest, null, 2));
}

async function exists(file) {
    try {
        await fs.access(file, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

async function downloadBlob(baseUrl, digest, path) {
    const url = `${baseUrl}/blobs/${digest}`;
    console.log(`Downloading ${url}...`);
    const response = await fetch(url);
    const file = await fs.open(path, "w");
    const body = Readable.fromWeb(response.body);
    await stream.finished(body.pipe(file.createWriteStream()));
}

async function downloadDigests(baseUrl, dir, manifest, config) {
    await fs.mkdir(path.join(dir, "blobs"), {recursive: true});

    const layers = [...manifest.layers];
    layers.push(manifest.config);

    for (const layer of layers) {
        const type = layer.mediaType.split(".").pop();
        if (config[type] && FILE_TYPES.includes(type)) {
            const file = new ModelFile(config[type]);
            if (await exists(file.path)) {
                layer.size = await file.size();
                layer.digest = await file.digest();
            } else {
                await downloadBlob(baseUrl, layer.digest, file.path);
            }

            const target = path.join(dir, "blobs", layer.digest.replace(":", "-"));
            console.log(`Linking ${target} to ${file.path}...`);
            await fs.rm(target, {force: true});
            await fs.symlink(file.path, target);
        } else {
            const file = path.join(dir, "blobs", layer.digest.replace(":", "-"));
            if (!await exists(file)) {
                await downloadBlob(baseUrl, layer.digest, file);
            }
        }
    }
}

async function pull(config) {
    let {from, registry, dir, name} = config;
    if (config.model && await exists(config.model) && (!from || !name)) {
        console.log("Parsing GGUF Metadata...");
        const model = new ModelFile(config.model);
        const {general} = await model.readMetadata();
        console.log(general);

        name = name || getModelName(general);
        from = from || general.architecture;
    }

    if (!from) {
        throw new Error("specify from model name or source model file.");
    }

    let {repository, model, version} = MODEL_REGEX.exec(from).groups;
    repository = repository || "library";
    version = version || "latest";
    const baseUrl = `https://${registry}/v2/${repository}/${model}`;

    const manifest = await downloadManifest(baseUrl, version);
    await downloadDigests(baseUrl, dir, manifest, config);
    await writeManifest(
        path.join(dir, "manifests", registry, repository, name || model),
        manifest
    );
}

async function printMetadata(file) {
    if(!file || !await exists(file.path)) {
        throw new Error("invalid model file.");
    }

    const model = new ModelFile(file);
    const metadata = await model.readMetadata();
    process.stdout.write(JSON.stringify(metadata, null, 2));
}

process.on('uncaughtException', console.error);
const args = util.parseArgs({options}).values;

if (args.show) {
    printMetadata(args.model);
} else {
    pull(args);
}
