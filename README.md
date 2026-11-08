# solc-bench

solc-bench compares Solidity compilers with solc on Foundry projects.

It builds and tests each project with each compiler. Then it shows the differences in build time, contract size and gas.

## Compilers

| Compiler | Version | Source |
|---|---|---|
| Solar | 0.3.0-dev (in Foundry v1.9.0) | [paradigmxyz/solar](https://github.com/paradigmxyz/solar) |
| Slang | preview v0.2.0 | [NomicFoundation/solx](https://github.com/NomicFoundation/solx) |
| solx | 0.1.8 | [NomicFoundation/solx](https://github.com/NomicFoundation/solx) |
| oksolc | 0.2.4 | [okcontract/oksolc](https://github.com/okcontract/oksolc) |
| solc-par | 0.1.2 (parallel solc wrapper) | [bussyjd/solc-par](https://github.com/bussyjd/solc-par) |
| solc | the versions that the project uses | Foundry |
| solc-latest | 0.8.38 for all files | Foundry |

## Requirements

- Node.js 22 or later
- Docker. On macOS, you can use OrbStack or Docker Desktop.

## Usage

Start the tool without arguments. It asks for the projects and the settings:

```sh
npx solc-bench-cli
```

Or give the projects as arguments:

```sh
npx solc-bench-cli https://github.com/morpho-org/metamorpho-v1.1
npx solc-bench-cli --runs 5 https://github.com/org/project#v1.0.0 ./my-project
```

A project can be a GitHub URL or a local folder. To use a branch, tag or commit, add `#name` to the URL.

Other commands:

```sh
npx solc-bench-cli report solc-bench-results/<run>   # show a saved result again
npx solc-bench-cli clean                             # remove the Docker image and caches
npx solc-bench-cli --help                            # show all options
```

The first run builds a Docker image. This takes approximately 15 minutes. Later runs use the saved image.

## Results

The summary shows two comparisons for each project:

1. **With the solc setup of the project.** This shows the change that you get if you replace your current compiler.
2. **With solc-latest.** solc-latest compiles all files with solc 0.8.38 and the EVM version of the project, as the new compilers do. This comparison shows the effect of the compiler only. It removes the effect of a newer Solidity version or a newer EVM version.

The tool measures:

- Build time: the median of clean builds, with the range. The first build of each compiler is not timed. The build order changes randomly in each round.
- Contract size: the size of the deployed bytecode.
- Deployment gas.
- Gas per function call: the median from the gas report of the project tests. For the gas report, fuzz inputs do not depend on the compiled bytecode, so all compilers get the same inputs.
- Tests: the number of tests that pass with the fuzz settings of the project. All compilers use the same fuzz seed.

The tool writes the results to `./solc-bench-results/<date>/`:

- `results.json`: the data.
- `logs/`: the output of each command.

## Security

The tool does not build or run project code on your computer. It does all work in a Docker container.

1. **Download step.** The container has network access. It downloads the projects and the solc versions that they need. It does not compile project code.
2. **Benchmark step.** The container has no network access. Project files and compilers are read-only. The container can write only to the results folder on your computer.

Other controls:

- The tool accepts only `https` URLs from `github.com`. Use `--allow-host` to add other hosts.
- Git hooks are disabled.
- The container runs as a normal user, not as root. It has limits for memory, CPU and processes.
- Each compiler and tool has a fixed version. The tool checks each downloaded file with a checksum.
- Terminal control codes from project output are removed before the tool shows the output.

## Limits

- Slang, solx and oksolc each report one fixed solc version. The tool changes the `pragma solidity` lines in a temporary copy of the project for these compilers. It does not change your files.
- Slang and solx support only the `cancun`, `prague` and `osaka` EVM versions. The tool skips them for other EVM versions.
- Slang and solx do not use the solc optimizer settings of the project.
- oksolc supports only the via-IR pipeline with the optimizer. The tool always uses these settings for oksolc.

## Development

```sh
npm ci
npm run build
node dist/cli.js --help
```

