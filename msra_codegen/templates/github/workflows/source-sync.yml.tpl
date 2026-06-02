name: {{ source_sync.name }}

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  source-sync:
    uses: {{ source_sync.logic_repository }}/.github/workflows/source-sync.yml@{{ source_sync.logic_ref }}
    with:
      logic_repository: {{ source_sync.logic_repository | tojson }}
      logic_ref: {{ source_sync.logic_ref | tojson }}
      source_repository: {{ source_sync.repository_expr }}
      source_ref: {{ source_sync.source_branch | tojson }}
      source_msra_path: {{ source_sync.source_msra_path | tojson }}
      target_repository: {{ source_sync.repository_expr }}
      target_ref: {{ source_sync.target_branch | tojson }}
      generator_python_version: {{ source_sync.python_version | tojson }}
      generator_requirements_path: {{ source_sync.generator_requirements_path | tojson }}
      commit_user_name: {{ source_sync.commit_user_name | tojson }}
      commit_user_email: {{ source_sync.commit_user_email | tojson }}
    secrets:
      repo_token: {{ source_sync.repo_token_expr }}
