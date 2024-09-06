# Ollama Create NodeJS

[![GitHub License](https://img.shields.io/github/license/GenericMale/ollama-create-nodejs?logo=github)](https://github.com/GenericMale/ollama-create-nodejs/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/genericmale/ollama-create-nodejs?label=commit&logo=github)](https://github.com/GenericMale/ollama-create-nodejs)
[![NPM Package Version](https://img.shields.io/npm/v/ollama-create?logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-create)
[![NPM Package Size](https://img.shields.io/npm/unpacked-size/ollama-create?label=size&logo=npm&logoColor=white)](https://www.npmjs.com/package/ollama-create)
[![NodeJS Version](https://img.shields.io/node/v/ollama-create?logo=node.js&logoColor=white)](https://www.npmjs.com/package/ollama-create)

## Introduction

NodeJS CLI script which simplifies adding GGUF models to Ollama by creating symlinks and downloading necessary metadata
from the Ollama Registry.

Benefits:

- Avoids model duplication within Ollama.
- Easy integration of GGUF models.
- No dependencies besides NodeJS.

## Installation

Requires NodeJS version 18.11.0 or higher. Install it globally using npm:

```shell
npm install -g ollama-create
```

## Usage

```
Usage: ollama-create [OPTIONS] [MODEL...]

Create a new Ollama model based on a base model from the Ollama registry.
MODEL can be a local GGUF file or the name of a model in the Ollama registry.

All specified files will be symlinked to Ollama to avoid duplication.
If a file is supplied which doesn't exist, it will be created from the base model in the specified location.
To remove a setting from the base model, use --no-<option>.

OPTIONS:
  -f, --from <from>           Defines the base model from the Ollama registry to use.
                              Defaults to the model architecture from the GGUF metadata.
  -n, --name <name>           Set the name for the new model.
                              Defaults to <name>-<size>-<finetune>-<version> from the GGUF metadata
                              or the base model name if no model file is specified.
  -d, --dir <dir>             Download all base model files to the specified directory and create symlinks for Ollama.

  -p, --params <json file>    Specify a JSON file containing parameters for Ollama.
  -m, --messages <json file>  Provide a JSON file containing the message history.
  -t, --template <txt file>   Define a file containing the full prompt template.
  -s, --system <txt file>     Specify a file containing the system message.
  -a, --adapter <gguf file>   Apply (Q)LoRA adapters to the model.
  -j, --projector <gguf file> Define multimodal projectors.
  -l, --license <txt file>    Specify a file containing the legal license.

  -g, --show                  Print the GGUF metadata of the model.
  -h, --help                  Display this help and exit.
```

## Example

### Download a model from the Ollama Registry

```shell
ollama-create gemma2
```

This will download the Gemma 2 model from the Ollama Registry and configure it in Ollama (same as `ollama pull gemma2`).

### Use existing GGUF model file

```shell
ollama-create --from llama3.1 my-model.gguf
```

This will use the local `my-model.gguf` file and configure it in Ollama by creating a symlink.
The Ollama metadata (template, params etc.) is taken from the Llama 3.1 model.

If `my-model.gguf` doesn't exist, the `llama3.1` model will be downloaded and saved as `my-model.gguf`.

### Use custom template

```shell
ollama-create --template my-template.txt gemma2
```

This will download the Gemma 2 model but use the local `my-template.txt` file as prompt template.

If `my-template.txt` doesn't exist, the template from the Gemma 2 model will be downloaded and saved as `my-template.txt`.

### Remove parameters

```shell
ollama-create --no-params gemma2
```

This will download the Gemma 2 model but removes all parameter instructions.

### Save all model files in custom location

```shell
ollama-create --dir ./models/gemma gemma2
```

This will download the Gemma 2 model and save all Ollama artifacts to the `./models/gemma/` directory.
Symlinks in the Ollama blob store are created for all files.


### Print GGUF metadata

```shell
ollama-create --metadata my-model.gguf
```

Prints the GGUF metadata of the model file as JSON.
