from __future__ import annotations

import shutil
from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py as _build_py


class build_py(_build_py):
    def run(self) -> None:
        self._vscode_lsp_output_files: list[str] = []
        self._vscode_lsp_output_mapping: dict[str, str] = {}
        super().run()
        self._copy_vscode_lsp_assets()

    def get_outputs(self):  # type: ignore[override]
        outputs = list(super().get_outputs())
        outputs.extend(getattr(self, "_vscode_lsp_output_files", []))
        return outputs

    def get_output_mapping(self):  # type: ignore[override]
        mapping = dict(super().get_output_mapping())
        mapping.update(getattr(self, "_vscode_lsp_output_mapping", {}))
        return mapping

    def _copy_vscode_lsp_assets(self) -> None:
        source_root = Path(__file__).resolve().parent / "vscode-extension" / "lsp"
        if not source_root.exists():
            raise FileNotFoundError(source_root)

        target_root = Path(self.build_lib) / "msra_codegen" / "vscode-extension" / "lsp"
        self.mkpath(str(target_root))
        for source_file in source_root.glob("*.js"):
            target_file = target_root / source_file.name
            shutil.copy2(source_file, target_file)
            target_output = str(target_file)
            self._vscode_lsp_output_files.append(target_output)
            self._vscode_lsp_output_mapping[target_output] = str(source_file)


setup(cmdclass={"build_py": build_py})
