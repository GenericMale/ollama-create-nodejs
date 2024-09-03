# Ollama Model Generator

[![GitHub License](https://img.shields.io/github/license/GenericMale/ollama-model-generator?logo=github)](https://github.com/GenericMale/ollama-model-generator/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/genericmale/ollama-model-generator?label=commit&logo=github)](https://github.com/GenericMale/ollama-model-generator)
[![NPM Package Version](https://img.shields.io/npm/v/ollama-model-generator?logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)
[![NPM Package Size](https://img.shields.io/npm/unpacked-size/ollama-model-generator?label=size&logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)
[![NodeJS Version](https://img.shields.io/node/v/ollama-model-generator?logo=node.js&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)

NodeJS script to add GGUF models to ollama. No dependencies besides NodeJS >= v19.

Creates symlinks for Ollama to avoid duplication and downloads required model metadata (template, params, prompts etc) from the Ollama Registry.

## Installation

```shell
npm install -g ollama-model-generator
```

## Usage

```shell
ollama-model-generator [options]

  Options:
  
    --parent <name>       The base model to use from the Ollama Registry. If not provided, the architecture from the GGUF metadata is used.
    --name <name>         Name of the new model in Ollama. If not provided <BaseName><SizeLabel><FineTune><Version><Type> from the GGUF metadata or (if GGUF file not provided) the parent model name is used.
    --registry <registry> The Ollama Registry to use. Default: registry.ollama.ai
    --modelsDir <path>    Directory for the Ollama model data. Defaults match with Ollama (~/.ollama/models or $OLLAMA_MODELS).
    --model <path>        The GGUF model to use. This is symlinked into the Ollama Models Directory (if provided) and can be used to guess the parent model and new model name.
    --metadata            Print model metadata from GGUF file header (requires --model to be set).
```

Additional custom metadata files can be symlinked using the following options (see [Ollama Model File](https://github.com/ollama/ollama/blob/main/docs/modelfile.md)):
```shell
--embed, --adapter, --projector, --prompt, --template, --system, --params, --messages, --license
```

The following command can be used to print the metadata from the [GGUF file header](https://github.com/ggerganov/ggml/blob/master/docs/gguf.md) without performing any action:
```shell
ollama-model-generator --metadata --model <path>
```
