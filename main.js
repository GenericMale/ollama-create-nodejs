#!/usr/bin/env node

/*
 * Licensed under the EUPL-1.2 or later.
 * You may obtain a copy of the licence at https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12
 */

const crypto = require("crypto");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const util = require("util");

const MODELS_DIR =
    process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");

const FILE_TYPES = [
    "model",
    "embed",
    "adapter",
    "projector",
    "prompt",
    "template",
    "system",
    "params",
    "messages",
    "license",
];
const MODEL_REGEX =
    /^(?:(?<repository>[\w.-]+)\/)?(?<model>[\w.-]+)(?::(?<version>[\w.-]+))?$/;

const options = {
    metadata: {
        type: "boolean",
        default: false,
    },
    parent: {
        type: "string",
    },
    name: {
        type: "string",
    },
    registry: {
        type: "string",
        default: "registry.ollama.ai",
    },
    modelsDir: {
        type: "string",
        default: MODELS_DIR,
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
                const val = i === keys.length - 1 ? value : prop[k] || {};
                prop = prop[k] = val;
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
    if (metadata.file_type) parts.push(metadata.file_type);
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

async function linkFiles(manifest, modelsDir, config) {
    const dir = path.join(modelsDir, "blobs");
    await fs.mkdir(dir, {recursive: true});

    for (const layer of manifest.layers) {
        const type = layer.mediaType.split(".").pop();
        if (!FILE_TYPES.includes(type) || !config[type]) return;

        const file = new ModelFile(config[type]);
        layer.size = await file.size();
        layer.from = file.path;
        layer.digest = await file.digest();

        const target = path.join(dir, layer.digest.replace(":", "-"));
        console.log(`Linking ${target} to ${file}...`);
        await fs.rm(target, {force: true});
        await fs.symlink(file.path, target);
    }
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

async function downloadDigests(baseUrl, modelsDir, manifest) {
    const digests = manifest.layers.filter((l) => !l.from).map((l) => l.digest);
    digests.push(manifest.config.digest);

    for (const digest of digests) {
        const blobFile = path.join(modelsDir, "blobs", digest.replace(":", "-"));
        if (await exists(blobFile)) continue;

        const url = `${baseUrl}/blobs/${digest}`;
        console.log(`Downloading ${url}...`);
        const response = await fetch(url);
        const data = await response.bytes();
        await fs.writeFile(blobFile, data);
    }
}

async function pull(config) {
    let {parent, registry, modelsDir, name} = config;
    if (config.model && (!parent || !name)) {
        console.log("Parsing GGUF Metadata...");
        const model = new ModelFile(config.model);
        const {general} = await model.readMetadata();
        console.log(general);

        name = name || getModelName(general);
        parent = parent || general.architecture;
    }

    if (!parent) {
        throw new Error("specify parent model name or source model file.");
    }

    let {repository, model, version} = MODEL_REGEX.exec(parent).groups;
    repository = repository || "library";
    version = version || "latest";
    const baseUrl = `https://${registry}/v2/${repository}/${model}`;

    const manifest = await downloadManifest(baseUrl, version);
    await linkFiles(manifest, modelsDir, config);
    await writeManifest(
        path.join(modelsDir, "manifests", registry, repository, name || model),
        manifest
    );
    await downloadDigests(baseUrl, modelsDir, manifest);
}

async function printMetadata(file) {
    const model = new ModelFile(file);
    const metadata = await model.readMetadata();
    process.stdout.write(JSON.stringify(metadata, null, 2));
}

const args = util.parseArgs({options}).values;
if (args.metadata) {
    printMetadata(args.model);
} else {
    pull(args);
}
