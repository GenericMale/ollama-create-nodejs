# Ollama Model Generator

[![GitHub License](https://img.shields.io/github/license/GenericMale/ollama-model-generator?logo=github)](https://github.com/GenericMale/ollama-model-generator/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/genericmale/ollama-model-generator?label=commit&logo=github)](https://github.com/GenericMale/ollama-model-generator)
[![NPM Package Version](https://img.shields.io/npm/v/ollama-model-generator?logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)
[![NPM Package Size](https://img.shields.io/npm/unpacked-size/ollama-model-generator?label=size&logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)
[![NodeJS Version](https://img.shields.io/node/v/ollama-model-generator?logo=node.js&logoColor=white)](https://www.npmjs.com/package/ollama-model-generator)

## Introduction

This NodeJS CLI script simplifies adding GGUF models to Ollama by creating symlinks and downloading necessary metadata
from the Ollama Registry.

Benefits:

- Avoids model duplication within Ollama.
- Easy integration of GGUF models.
- No dependencies besides NodeJS.

## Installation

Requires NodeJS version 18.11.0 or higher. Install it globally using npm:

```shell
npm install -g ollama-model-generator
```

## Usage

```
ollama-model-generator [options]

  Options:
    --model <path>            Path to the GGUF model file. This will be symlinked to Ollama blob storage.
                              If the file doesn't exist, it will be downloaded from the Ollama Registry based on --from.
                              Optional. If not provided, the model will be downloaded to the Ollama blob storage.
  
    --from, -f <name>         Model name in the Ollama Registry to download as a base.
                              Default: architecture of the GGUF model.
                              
    --name, -n <name>         Name of the new model in Ollama.
                              Default: basename-size-finetune-version of the GGUF model.
                              If --model is not provided, it defaults to the name from --from.
                              
    --show, -s                Prints model metadata from the GGUF file header as JSON (requires --model).
    
    --registry, -r <registry> The Ollama Registry URL.
                              Default: registry.ollama.ai
    
    --dir, -d <path>          Directory for storing Ollama model data.
                              Default: $OLLAMA_MODELS or ~/.ollama/models
```

Additional files can be symlinked in the same way as --model (
see [Ollama Model File](https://github.com/ollama/ollama/blob/main/docs/modelfile.md)):

```
--adapter, --embed, --license, --messages, --params, --projector, --prompt, --system, --template
```

## Example

### Download a model from the Ollama Registry

```shell
ollama-model-generator --from gemma2
```

This will download the Gemma 2 model from the Ollama Registry and configure it in Ollama (same as `ollama pull gemma2`).

### Use a local GGUF model

```shell
ollama-model-generator --from llama3.1 --model my-model.gguf --name LLama3.1-MyModel
```

This will use the local `my-model.gguf` file and configure it in Ollama with the name `LLama3.1-MyModel`.
The Ollama metadata (template, params etc.) is taken from the Llama 3.1 model.

### Use custom template

```shell
ollama-model-generator --from gemma2 --template my-template.txt
```

This will download the Gemma 2 model but use the local `my-template.txt` file as prompt template.

### Print GGUF metadata

```shell
ollama-model-generator --show --model my-model.gguf
```

Prints the GGUF metadata of the model file as JSON.
