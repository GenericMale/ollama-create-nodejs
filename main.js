#!/usr/bin/env node

/*
 * Licensed under the EUPL-1.2 or later.
 * You may obtain a copy of the licence at https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12
 */

const crypto = require('crypto')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const stream = require('stream/promises')
const { Readable } = require('stream')
const util = require('util')

const MODELS_DIR = process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
const DIGEST_ALGORITHM = 'sha256'
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
const OLLAMA_IMAGE = 'application/vnd.ollama.image.'

const DEFAULT_REGISTRY = 'registry.ollama.ai'
const DEFAULT_REPOSITORY = 'library'
const DEFAULT_VERSION = 'latest'

const METADATA_OVERRIDES = {
  'tokenizer.ggml.tokens': [],
  'tokenizer.ggml.scores': [],
  'tokenizer.ggml.token_type': [],
  'tokenizer.ggml.merges': [],
  'tokenizer.ggml.added_tokens': []
}

const FILE_EXTENSIONS = {
  model: 'gguf',
  params: 'json',
  messages: 'json',
  template: 'txt',
  system: 'txt',
  adapter: 'gguf',
  projector: 'gguf',
  license: 'txt'
}

const OPTIONS = {
  from: {
    type: 'string',
    short: 'b',
    description:
      'Defines the base model from the Ollama registry to use.\n' +
      'Default: architecture from GGUF metadata.'
  },
  name: {
    type: 'string',
    short: 'n',
    description:
      'Set the name for the new model.\n' +
      'Default: basename-size_label-finetune-version from metadata\n' +
      'or Ollama base model name if no model file is specified.'
  },
  dir: {
    type: 'string',
    short: 'd',
    description:
      'Download all Ollama model files to the specified directory\n' +
      'and create symlinks for Ollama.'
  },
  force: {
    type: 'boolean',
    short: 'f',
    description: 'Force re-download of all blobs, even if they already exit.\n'
  },

  params: {
    type: 'string',
    short: 'p',
    multiple: true,
    description: 'Specify a JSON file containing parameters for Ollama.'
  },
  messages: {
    type: 'string',
    short: 'm',
    multiple: true,
    description: 'Provide a JSON file containing the message history.'
  },
  template: {
    type: 'string',
    short: 't',
    multiple: true,
    description: 'Define a file containing the full prompt template.'
  },
  system: {
    type: 'string',
    short: 's',
    multiple: true,
    description: 'Specify a file containing the system message.'
  },
  adapter: {
    type: 'string',
    short: 'a',
    multiple: true,
    description: '(Q)LoRA adapters to apply to the model.'
  },
  projector: {
    type: 'string',
    multiple: true,
    description: 'Add multimodal projectors.'
  },
  license: {
    type: 'string',
    short: 'l',
    multiple: true,
    description: 'Specify a file containing the legal license.\n'
  },

  metadata: {
    type: 'boolean',
    description: 'Print the GGUF metadata of the model and exit.'
  },
  help: {
    type: 'boolean',
    short: 'h',
    description: 'Display this help and exit.'
  }
}

function calculateDigest (filePath) {
  console.log(`Calculating Digest of ${filePath}`)
  return new Promise((resolve, reject) => {
    fs.open(filePath).then((file) => {
      const hash = crypto.createHash(DIGEST_ALGORITHM)
      const stream = file.createReadStream()
      stream.on('data', (d) => hash.update(d))
      stream.on('error', (e) => {
        reject(e)
        file?.close()
      })
      stream.on('end', () => {
        resolve(`${DIGEST_ALGORITHM}:${hash.digest('hex')}`)
        file?.close()
      })
    }, reject)
  })
}

async function downloadJSON (url) {
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to download ${url}: ${response.statusText}`)

  const json = await response.json()
  if (json.errors) {
    const msg = json.errors[0].message || json.errors[0].code || ''
    throw new Error(`failed to download ${url}: ${msg}`)
  }
  return json
}

async function saveJSON (filePath, json) {
  console.log(`Writing ${filePath}`)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.rm(filePath, { force: true })
  await fs.writeFile(filePath, JSON.stringify(json))
}

async function downloadToFile (url, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.rm(filePath, { force: true })

  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to download ${url}: ${response.statusText}`)

  const bytes = Number(response.headers.get('content-length'))
  const power = Math.floor(Math.log(bytes) / Math.log(1000))
  const size = (bytes / Math.pow(1000, power)).toFixed(1)

  console.log(`Downloading ${url} (${size} ${SIZE_UNITS[power]})`)
  const body = Readable.fromWeb(response.body)

  let file
  try {
    file = await fs.open(filePath, 'w')
    await stream.finished(body.pipe(file.createWriteStream()))
  } finally {
    await file?.close()
  }
}

async function fileExists (path) {
  if (path) {
    try {
      await fs.access(path, fs.constants.R_OK)
      return true
    } catch {}
  }
  return false
}

function joinByDash (...parts) {
  return parts.filter(Boolean).join('-').replace(/\s/g, '-')
}

function toFlatString (obj) {
  return Object.entries(obj)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')
}

async function parseGGUFMetadata (filePath, quick) {
  const metadata = {}
  let file
  let offset = 0
  let littleEndian = false

  const read = async (bytes) => {
    const { buffer } = await file.read(Buffer.alloc(bytes), 0, bytes, offset)
    offset += bytes
    return littleEndian ? buffer.reverse() : buffer
  }

  const readType = async (type) => {
    switch (type) {
      case 0:
        return (await read(1)).readUInt8()
      case 1:
        return (await read(1)).readInt8()
      case 2:
        return (await read(2)).readUInt16BE()
      case 3:
        return (await read(2)).readInt16BE()
      case 4:
        return (await read(4)).readUInt32BE()
      case 5:
        return (await read(4)).readInt32BE()
      case 6:
        return (await read(4)).readFloatBE()
      case 7:
        return (await read(1)).readInt8() !== 0
      case 8: {
        const length = await readLength()
        return (await read(length)).reverse().toString()
      }
      case 9: {
        const arrayType = await readType(4)
        const length = await readLength()
        const array = []
        for (let i = 0; i < length; i++) {
          array.push(await readType(arrayType))
        }
        return array
      }
      case 10:
        return Number((await read(8)).readBigUInt64BE())
      case 11:
        return Number((await read(8)).readBigInt64BE())
      case 12:
        return (await read(8)).readDoubleBE()
      default:
        throw new Error(`not a valid gguf file: unsupported type ${type}`)
    }
  }

  const readLength = () => metadata.version === 1 ? readType(4) : readType(10)

  try {
    file = await fs.open(filePath)

    const magic = (await read(4)).toString()
    if (magic !== 'GGUF') throw new Error('not a valid gguf file: not starting with GGUF magic number')

    const version = await read(4)
    metadata.version = version.readUInt32LE()
    if (metadata.version <= 3 && metadata.version >= 1) {
      littleEndian = true
    } else {
      metadata.version = version.readUInt32BE()
      if (metadata.version > 3 || metadata.version < 1) throw new Error('not a valid gguf file: unsupported version')
    }

    metadata.tensor_count = await readLength()
    metadata.kv_count = await readLength()

    for (let i = 0; i < metadata.kv_count; i++) {
      const key = await readType(8)
      const type = await readType(4)
      const value = await readType(type)
      if (quick && METADATA_OVERRIDES[key]) break

      let prop = metadata
      key.split('.').forEach((k, i, keys) => {
        if (i === keys.length - 1) {
          prop[k] = METADATA_OVERRIDES[key] || value
        } else if (prop[k] === undefined) {
          prop[k] = {}
        } else if (!(prop[k] instanceof Object)) {
          prop[k] = { value: prop[k] }
        }
        prop = prop[k]
      })
    }
    return metadata
  } finally {
    await file?.close()
  }
}

async function createSymlink (blobsDir, digest, file) {
  console.log(`Linking ${/:(.{12})/.exec(digest)[1]} to ${file}`)
  const target = path.join(blobsDir, digest.replace(':', '-'))
  await fs.mkdir(blobsDir, { recursive: true })
  await fs.rm(target, { force: true })
  await fs.symlink(path.resolve(file), target)
}

function getFileInDir (dir, mediaType, prefix, cnt) {
  if (!dir) return

  const type = mediaType.replace(/.*[.+]/, '')
  const ext = FILE_EXTENSIONS[type]
  cnt[type] = (cnt[type] || -1) + 1
  const name = joinByDash(prefix, type !== 'model' && ext && type, cnt[type])
  return path.join(dir, `${name}.${ext || type}`)
}

async function downloadLayers (blobsUrl, blobsDir, layers, localFiles, outDir, modelName, force) {
  const newLayers = []
  const cnt = {}
  for (const layer of layers) {
    // prompt is the same as template
    const files = localFiles[layer.mediaType.replace(/\.prompt$/, '.template')]
    if (files === false) continue

    const url = `${blobsUrl}/${layer.digest}`
    const blobFile = path.join(blobsDir, layer.digest.replace(':', '-'))
    const file = files ? files.shift() : getFileInDir(outDir, layer.mediaType, modelName, cnt)
    if (file) {
      if (await fileExists(file)) {
        layer.digest = await calculateDigest(file)
        layer.size = (await fs.stat(file)).size
      } else {
        await downloadToFile(url, file)
      }
      await createSymlink(blobsDir, layer.digest, file)
    } else if (force || !await fileExists(blobFile)) {
      await downloadToFile(url, blobFile)
    }
    newLayers.push(layer)
  }
  for (const [mediaType, files] of Object.entries(localFiles)) {
    if (!files) continue
    for (const file of files) {
      if (!await fileExists(file)) {
        console.warn(`Warning: file ${file || ''} not found`)
        continue
      }

      const digest = await calculateDigest(file)
      const size = (await fs.stat(file)).size
      await createSymlink(blobsDir, digest, file)
      newLayers.push({ mediaType, size, digest })
    }
  }
  return newLayers
}

function parseModelName (modelName) {
  // registry/repository/name:version
  const [nameVersion, repository = DEFAULT_REPOSITORY, registry = DEFAULT_REGISTRY] = modelName.split('/').reverse()
  const [name, version = DEFAULT_VERSION] = nameVersion.split(':')
  const url = `https://${registry}/v2/${repository}/${name}`
  return {
    registry,
    repository,
    name,
    version,
    manifestUrl: `${url}/manifests/${version}`,
    manifestPath: path.join(MODELS_DIR, 'manifests', registry, repository, name, version),
    blobsUrl: `${url}/blobs`,
    blobsPath: path.join(MODELS_DIR, 'blobs')
  }
}

async function createOllamaModel (name, from, localFiles, outDir, force) {
  const model = localFiles[OLLAMA_IMAGE + 'model'][0]
  if ((!from || !name) && await fileExists(model)) {
    console.log(`Reading Metadata of ${model}`)
    const { general } = await parseGGUFMetadata(model, true)
    console.log(toFlatString(general))

    name = name || joinByDash(general.basename || general.name, general.size_label, general.finetune, general.version)
    from = from || general.architecture
  }

  if (!from) {
    if (!model) throw new Error('missing model')
    from = model
    delete localFiles[OLLAMA_IMAGE + 'model']
  }
  name = name || from

  const { manifestUrl, blobsUrl } = parseModelName(from)
  const { manifestPath, blobsPath } = parseModelName(name)
  const updateModel = await fileExists(manifestPath)
  console.log(`${updateModel ? 'Updating existing' : 'Creating new'} Ollama Model ${name}...`)

  const manifest = await downloadJSON(manifestUrl)
  const config = manifest.config.digest
  const configFile = path.join(blobsPath, config.replace(':', '-'))
  if (force || !await fileExists(configFile)) {
    await downloadToFile(`${blobsUrl}/${config}`, configFile)
  }

  manifest.layers = await downloadLayers(blobsUrl, blobsPath, manifest.layers, localFiles, outDir, name, force)
  await saveJSON(manifestPath, manifest)
  console.log(`Ollama Model ${name} successfully ${updateModel ? 'updated' : 'created'}!`)
}

async function printGGUFMetadata (model) {
  if (!await fileExists(model) && model) {
    const { manifestPath, blobsPath } = parseModelName(model)
    if (!await fileExists(manifestPath)) throw new Error(`invalid model ${model}`)

    const { layers } = JSON.parse(await fs.readFile(manifestPath, { encoding: 'utf8' }))
    const modelLayer = layers ? layers.find(l => l.mediaType.split('.').pop() === 'model') : null
    if (!modelLayer) throw new Error(`invalid model ${model}`)

    model = path.join(blobsPath, modelLayer.digest.replace(':', '-'))
  }

  if (!await fileExists(model)) throw new Error(`invalid model ${model || ''}`)

  const metadata = await parseGGUFMetadata(model)
  process.stdout.write(JSON.stringify(metadata, null, 2))
}

function printHelp () {
  let padding = ''
  const options = Object.entries(OPTIONS).map(([option, { short, description, type, multiple }]) => {
    const typeTxt = type === 'string' ? (multiple ? '<file> ' : `<${option}> `) : ''
    const txt = '  ' + (short ? `-${short}, ` : '    ') + `--${option} ${typeTxt}`
    padding += ' '.repeat(Math.max(txt.length - padding.length, 0))
    return [txt, description]
  }).map(([options, description]) => {
    const lines = description.split('\n')
    const txt = options + padding.substring(options.length) + lines[0]
    return txt + lines.slice(1).map(l => '\n' + padding + l).join('')
  }).join('\n')

  console.log(
    'Usage: ollama-create [OPTIONS] [MODEL...]\n\n' +

    'Create a new Ollama model based on a base model from the Ollama registry.\n' +
    'MODEL can be a local GGUF file or the name of a model in the Ollama registry.\n\n' +
    'All specified files will be symlinked to the Ollama model directory to avoid duplication.\n' +
    'If a file is supplied which doesn’t exist,\n' +
    'it will be created from the base model in the specified location.\n' +
    'To exclude a setting from the base model, use --no-<option>.\n\n' +

    'OPTIONS:\n' +
    options
  )
}

const { values: args, positionals, tokens } = util.parseArgs({ options: OPTIONS, tokens: true, strict: false })
tokens.filter(t => t.kind === 'option').forEach(t => {
  if (t.name.startsWith('no-')) {
    args[t.name.slice(3)] = false
    delete args[t.name]
  }
})

if (args.help) {
  printHelp()
} else if (args.metadata) {
  printGGUFMetadata(positionals[0]).catch(e => console.error(`Error: ${e.message}`))
} else {
  const types = Object.entries(OPTIONS).filter(([, { multiple }]) => multiple).map(([k]) => k)
  const localFiles = types.reduce((files, type) => ({ ...files, [OLLAMA_IMAGE + type]: args[type] }), {})
  localFiles[OLLAMA_IMAGE + 'model'] = positionals

  createOllamaModel(args.name, args.from, localFiles, args.dir, args.force)
    .catch(e => console.error(`Error: ${e.message}`))
}
