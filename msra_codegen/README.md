# msra-codegen

MSRA to async Python client generator.

## Install

```powershell
pip install msra-codegen
```

## Usage

```powershell
msra-codegen generate .\examples\example\example.msra -o .\generated
msra-codegen validate .\generated
```

The module entrypoint stays available as well:

```powershell
python -m msra_codegen generate .\examples\example\example.msra -o .\generated
python -m msra_codegen validate .\generated
```
